//! Tauri backend: spawns `codex app-server` (stdio JSONL transport) and bridges
//! JSON-RPC lines between the webview and the child process.
//!
//! Webview -> Rust: `rpc_send(line)` writes one JSON line to app-server stdin.
//! Rust -> Webview: every stdout line is emitted as the `codex-rpc` event.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Default)]
struct ServerState {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<std::process::ChildStdin>>,
}

#[derive(Serialize, Clone)]
struct ServerInfo {
    codex_bin: String,
    codex_home: Option<String>,
    pid: u32,
}

fn default_codex_bin() -> String {
    if let Ok(v) = std::env::var("CODEX_BIN") {
        return v;
    }
    // Sibling checkout: ~/github/codex/codex-rs/target/debug/codex
    let home = std::env::var("HOME").unwrap_or_default();
    let candidate = format!("{home}/github/codex/codex-rs/target/debug/codex");
    if std::path::Path::new(&candidate).exists() {
        return candidate;
    }
    "codex".to_string()
}

fn default_codex_home() -> Option<String> {
    if let Ok(v) = std::env::var("CODEX_HOME") {
        return Some(v);
    }
    let home = std::env::var("HOME").ok()?;
    let candidate = format!("{home}/.codex-dev");
    std::path::Path::new(&candidate).exists().then_some(candidate)
}

/// Start (or restart) the app-server child process.
#[tauri::command]
fn start_server(
    app: AppHandle,
    state: State<'_, ServerState>,
    codex_bin: Option<String>,
    codex_home: Option<String>,
) -> Result<ServerInfo, String> {
    stop_server(state.clone())?;

    let bin = codex_bin.unwrap_or_else(default_codex_bin);
    let home = codex_home.or_else(default_codex_home);

    let mut cmd = Command::new(&bin);
    cmd.arg("app-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(h) = &home {
        cmd.env("CODEX_HOME", h);
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn `{bin} app-server`: {e}"))?;

    let pid = child.id();
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let stdin = child.stdin.take().ok_or("no stdin")?;

    // stdout: one JSON-RPC message per line -> `codex-rpc` event
    let app_out = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => {
                    let _ = app_out.emit("codex-rpc", l);
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        let _ = app_out.emit("codex-exit", ());
    });

    // stderr: tracing logs -> `codex-log` event
    let app_err = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let _ = app_err.emit("codex-log", line);
        }
    });

    *state.stdin.lock().unwrap() = Some(stdin);
    *state.child.lock().unwrap() = Some(child);

    Ok(ServerInfo {
        codex_bin: bin,
        codex_home: home,
        pid,
    })
}

#[tauri::command]
fn stop_server(state: State<'_, ServerState>) -> Result<(), String> {
    *state.stdin.lock().unwrap() = None;
    if let Some(mut child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

/// Write one raw JSON-RPC line to app-server stdin.
#[tauri::command]
fn rpc_send(state: State<'_, ServerState>, line: String) -> Result<(), String> {
    let mut guard = state.stdin.lock().unwrap();
    let stdin = guard.as_mut().ok_or("app-server not running")?;
    stdin
        .write_all(line.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|e| format!("write failed: {e}"))
}

#[tauri::command]
fn default_cwd() -> String {
    std::env::var("CODEX_IDE_CWD")
        .ok()
        .or_else(|| std::env::current_dir().ok().map(|p| p.display().to_string()))
        .unwrap_or_else(|| "/".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ServerState::default())
        .invoke_handler(tauri::generate_handler![
            start_server,
            stop_server,
            rpc_send,
            default_cwd
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state: State<'_, ServerState> = window.state();
                let _ = stop_server(state);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
