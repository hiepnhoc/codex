import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { rpc } from "./lib/rpc";
import { readFile } from "./lib/fs";
import type { ModelListResponse } from "./protocol/v2/ModelListResponse";
import type { ConfigReadResponse } from "./protocol/v2/ConfigReadResponse";
import { FileTree } from "./components/FileTree";
import { Editor, CHANGES_TAB, type Tab } from "./components/Editor";
import { Terminal } from "./components/Terminal";
import { AgentPanel, type AgentStatus } from "./components/AgentPanel";
import "./app.css";

type Boot = "booting" | "ready" | "error";

export default function App() {
  const [boot, setBoot] = useState<Boot>("booting");
  const [bootMsg, setBootMsg] = useState("starting app-server…");
  const [cwd, setCwd] = useState("");
  const [cwdInput, setCwdInput] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [turnDiff, setTurnDiff] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(true);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>("ready");
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await rpc.start();
        setBootMsg(`pid ${info.pid} · ${info.codex_bin} · CODEX_HOME=${info.codex_home ?? "default"}`);
        await rpc.initialize({ name: "codex-ide", title: "Codex IDE", version: "0.1.0" });
        const wd = await invoke<string>("default_cwd");
        const cfg = await rpc.request<ConfigReadResponse>("config/read", { cwd: wd });
        const configured = cfg.config.model ?? "";
        const list = await rpc.request<ModelListResponse>("model/list", { includeHidden: true }).catch(() => null);
        const ids = Array.from(new Set([configured, ...(list?.data.map((m) => m.model) ?? [])].filter(Boolean)));
        if (cancelled) return;
        setCwd(wd);
        setCwdInput(wd);
        setModels(ids);
        setModel(configured || ids[0] || "");
        setBoot("ready");
      } catch (e) {
        console.error("boot failed:", e);
        setBoot("error");
        setBootMsg(String(e));
      }
    })();
    const offLog = rpc.onLog((l) => setLogs((p) => [...p.slice(-200), l]));
    const offExit = rpc.onExit(() => {
      setBoot("error");
      setBootMsg("app-server exited");
    });
    return () => {
      cancelled = true;
      offLog();
      offExit();
    };
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      if (!tabs.some((t) => t.path === path)) {
        try {
          const content = await readFile(path);
          setTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, content, saved: content }]));
        } catch (e) {
          setBootMsg(`open failed: ${e}`);
          return;
        }
      }
      setActive(path);
    },
    [tabs],
  );

  const onTurnDiff = useCallback((d: string | null) => {
    setTurnDiff(d);
    if (d) setActive((a) => a ?? CHANGES_TAB);
  }, []);

  const onAgentStatus = useCallback((s: AgentStatus) => setAgentStatus(s), []);

  const applyCwd = () => {
    if (cwdInput && cwdInput !== cwd) {
      setCwd(cwdInput);
      setTabs([]);
      setActive(null);
    }
  };

  if (boot !== "ready") {
    return (
      <div className={`boot status-${boot}`}>
        <div className="sidebar-title">Codex IDE</div>
        <div className="mono small">{bootMsg}</div>
        {boot === "error" && <pre className="mono tiny logs-pre">{logs.slice(-30).join("\n")}</pre>}
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-title">Codex IDE</div>
        <div className="row">
          <input
            className="mono small grow"
            value={cwdInput}
            onChange={(e) => setCwdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyCwd()}
            title="workspace root (Enter to apply)"
          />
        </div>
        <div className="tree-scroll">
          <FileTree root={cwd} selected={active} onOpen={openFile} />
        </div>
        <details className="logs">
          <summary className="muted tiny">server logs ({logs.length})</summary>
          <pre className="mono tiny logs-pre">{logs.slice(-40).join("\n")}</pre>
        </details>
      </aside>

      <main className="center">
        <Editor tabs={tabs} active={active} onTabsChange={setTabs} onActivate={setActive} turnDiff={turnDiff} />
        <div className="panel-bar">
          <span className="small" onClick={() => setShowTerminal((s) => !s)} style={{ cursor: "pointer" }}>
            {showTerminal ? "▾" : "▸"} Terminal
          </span>
          <span className="muted tiny" style={{ marginLeft: "auto" }}>
            {bootMsg}
          </span>
        </div>
        {showTerminal && <Terminal cwd={cwd} />}
      </main>

      <aside className="right">
        <div className="row model-row">
          <input className="mono small grow" list="models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" />
          <datalist id="models">
            {models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
          <span className={`dot status-${agentStatus}`} title={agentStatus} />
        </div>
        <AgentPanel cwd={cwd} model={model} onTurnDiff={onTurnDiff} onOpenFile={openFile} onStatus={onAgentStatus} />
      </aside>
    </div>
  );
}
