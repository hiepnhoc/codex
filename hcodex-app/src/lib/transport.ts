/**
 * How JSON-RPC lines reach `hcodex app-server`.
 *
 * - In the desktop app: the Tauri backend spawns app-server and bridges its stdio.
 * - In a plain browser, for developing and testing the UI without the native shell:
 *     hcodex app-server --listen ws://127.0.0.1:4599
 *     CODEX_IDE_WS=ws://127.0.0.1:4599 pnpm dev
 *   then open http://localhost:1420/?cwd=<workspace>. The page talks to `/codex-ws`, which
 *   the dev server forwards (see vite.config.ts); `?ws=<url>` overrides the endpoint.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type ServerInfo = { codex_bin: string; codex_home: string | null; pid: number };

export type TransportHandlers = {
  onLine: (line: string) => void;
  onLog: (line: string) => void;
  onExit: () => void;
};

export interface Transport {
  start(handlers: TransportHandlers, opts?: { codexBin?: string; codexHome?: string }): Promise<ServerInfo>;
  send(line: string): Promise<void>;
  stop(): Promise<void>;
  defaultCwd(): Promise<string>;
  log(level: string, message: string): void;
}

export const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

class TauriTransport implements Transport {
  private unlisten: Array<() => void> = [];

  async start(handlers: TransportHandlers, opts?: { codexBin?: string; codexHome?: string }) {
    this.unlisten.push(
      await listen<string>("codex-rpc", (e) => handlers.onLine(e.payload)),
      await listen<string>("codex-log", (e) => handlers.onLog(e.payload)),
      await listen("codex-exit", () => handlers.onExit()),
    );
    return invoke<ServerInfo>("start_server", {
      codexBin: opts?.codexBin ?? null,
      codexHome: opts?.codexHome ?? null,
    });
  }

  async send(line: string) {
    await invoke("rpc_send", { line });
  }

  async stop() {
    this.unlisten.forEach((u) => u());
    this.unlisten = [];
    await invoke("stop_server");
  }

  defaultCwd() {
    return invoke<string>("default_cwd");
  }

  log(level: string, message: string) {
    invoke("frontend_log", { level, message }).catch(() => {});
  }
}

const defaultWs = () => `ws://${location.host}/codex-ws`;

class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private params = new URLSearchParams(typeof location !== "undefined" ? location.search : "");

  start(handlers: TransportHandlers) {
    const url = this.params.get("ws") ?? defaultWs();
    return new Promise<ServerInfo>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () => resolve({ codex_bin: url, codex_home: null, pid: 0 });
      ws.onerror = () => reject(new Error(`cannot reach app-server at ${url} (see src/lib/transport.ts for the browser setup)`));
      ws.onmessage = (e) => handlers.onLine(String(e.data));
      ws.onclose = () => handlers.onExit();
    });
  }

  async send(line: string) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("app-server not connected");
    this.ws.send(line);
  }

  async stop() {
    this.ws?.close();
    this.ws = null;
  }

  async defaultCwd() {
    return this.params.get("cwd") ?? "/";
  }

  log() {}
}

export const transport: Transport = inTauri ? new TauriTransport() : new WebSocketTransport();
