/**
 * JSON-RPC 2.0 client over the Tauri bridge to `codex app-server`.
 *
 * - request(method, params)  -> Promise<result>
 * - onNotification(method, cb)
 * - onServerRequest(method, handler) : handler must return the response payload
 *   (used for approvals / requestUserInput / tool calls).
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { InitializeParams } from "../protocol/InitializeParams";
import type { InitializeResponse } from "../protocol/InitializeResponse";

type Json = unknown;
type Pending = { resolve: (v: Json) => void; reject: (e: Error) => void; method: string };
type NotificationHandler = (params: Json, method: string) => void;
type ServerRequestHandler = (params: Json, id: number | string) => Promise<Json> | Json;

export class RpcError extends Error {
  constructor(public code: number, message: string, public data?: Json) {
    super(message);
  }
}

export class CodexRpc {
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private notifHandlers = new Map<string, Set<NotificationHandler>>();
  private anyHandlers = new Set<NotificationHandler>();
  private serverReqHandlers = new Map<string, ServerRequestHandler>();
  private unlisten: UnlistenFn[] = [];
  private logHandlers = new Set<(line: string) => void>();
  private exitHandlers = new Set<() => void>();

  async start(opts?: { codexBin?: string; codexHome?: string }) {
    this.unlisten.push(
      await listen<string>("codex-rpc", (e) => this.onLine(e.payload)),
      await listen<string>("codex-log", (e) => this.logHandlers.forEach((h) => h(e.payload))),
      await listen("codex-exit", () => this.exitHandlers.forEach((h) => h())),
    );
    const info = await invoke<{ codex_bin: string; codex_home: string | null; pid: number }>(
      "start_server",
      { codexBin: opts?.codexBin ?? null, codexHome: opts?.codexHome ?? null },
    );
    return info;
  }

  async initialize(clientInfo: InitializeParams["clientInfo"]): Promise<InitializeResponse> {
    const params: InitializeParams = { clientInfo, capabilities: null };
    const res = (await this.request("initialize", params)) as InitializeResponse;
    this.notify("initialized");
    return res;
  }

  async stop() {
    this.unlisten.forEach((u) => u());
    this.unlisten = [];
    await invoke("stop_server");
  }

  request<T = Json>(method: string, params?: Json): Promise<T> {
    const id = this.nextId++;
    const line = JSON.stringify({ id, method, params: params ?? {} });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: Json) => void, reject, method });
      invoke("rpc_send", { line }).catch((e) => {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  notify(method: string, params?: Json) {
    const line = JSON.stringify(params === undefined ? { method } : { method, params });
    return invoke("rpc_send", { line });
  }

  onNotification(method: string, cb: NotificationHandler): () => void {
    let set = this.notifHandlers.get(method);
    if (!set) this.notifHandlers.set(method, (set = new Set()));
    set.add(cb);
    return () => set!.delete(cb);
  }

  onAnyNotification(cb: NotificationHandler): () => void {
    this.anyHandlers.add(cb);
    return () => this.anyHandlers.delete(cb);
  }

  onServerRequest(method: string, handler: ServerRequestHandler) {
    this.serverReqHandlers.set(method, handler);
  }

  onLog(cb: (line: string) => void): () => void {
    this.logHandlers.add(cb);
    return () => this.logHandlers.delete(cb);
  }

  onExit(cb: () => void): () => void {
    this.exitHandlers.add(cb);
    return () => this.exitHandlers.delete(cb);
  }

  private async onLine(raw: string) {
    let msg: Record<string, Json>;
    try {
      msg = JSON.parse(raw);
    } catch {
      console.warn("[rpc] non-JSON line", raw);
      return;
    }
    const hasId = msg.id !== undefined && msg.id !== null;
    const method = msg.method as string | undefined;

    if (hasId && method) {
      // server -> client request
      const id = msg.id as number | string;
      const handler = this.serverReqHandlers.get(method);
      if (!handler) {
        await invoke("rpc_send", {
          line: JSON.stringify({ id, error: { code: -32601, message: `unhandled server request ${method}` } }),
        });
        return;
      }
      try {
        const result = await handler(msg.params, id);
        await invoke("rpc_send", { line: JSON.stringify({ id, result }) });
      } catch (e) {
        await invoke("rpc_send", {
          line: JSON.stringify({ id, error: { code: -32000, message: String(e) } }),
        });
      }
      return;
    }

    if (hasId) {
      // response
      const p = this.pending.get(msg.id as number);
      if (!p) return;
      this.pending.delete(msg.id as number);
      if (msg.error) {
        const err = msg.error as { code: number; message: string; data?: Json };
        p.reject(new RpcError(err.code, `${p.method}: ${err.message}`, err.data));
      } else {
        p.resolve(msg.result);
      }
      return;
    }

    if (method) {
      this.notifHandlers.get(method)?.forEach((h) => h(msg.params, method));
      this.anyHandlers.forEach((h) => h(msg.params, method));
    }
  }
}

export const rpc = new CodexRpc();
