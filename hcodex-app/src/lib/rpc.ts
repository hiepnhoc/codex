/**
 * JSON-RPC 2.0 client for `hcodex app-server` (over the transport in `transport.ts`).
 *
 * - request(method, params)  -> Promise<result>
 * - onNotification(method, cb)
 * - onServerRequest(method, handler) : handler must return the response payload
 *   (used for approvals / requestUserInput / tool calls).
 */
import { transport, type ServerInfo } from "./transport";
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
  private logHandlers = new Set<(line: string) => void>();
  private exitHandlers = new Set<() => void>();
  private starting: Promise<ServerInfo> | null = null;

  /** Spawn app-server once; concurrent/repeated calls (React StrictMode) share the same start. */
  start(opts?: { codexBin?: string; codexHome?: string }) {
    if (!this.starting) {
      this.starting = this.doStart(opts).catch((e) => {
        this.starting = null;
        throw e;
      });
    }
    return this.starting;
  }

  private doStart(opts?: { codexBin?: string; codexHome?: string }) {
    return transport.start(
      {
        onLine: (line) => this.onLine(line),
        onLog: (line) => this.logHandlers.forEach((h) => h(line)),
        onExit: () => this.exitHandlers.forEach((h) => h()),
      },
      opts,
    );
  }

  private initialized: Promise<InitializeResponse> | null = null;

  /** Handshake once per connection (server rejects repeated `initialize`). */
  initialize(clientInfo: InitializeParams["clientInfo"]): Promise<InitializeResponse> {
    if (!this.initialized) {
      const params: InitializeParams = { clientInfo, capabilities: { experimentalApi: true, requestAttestation: false } };
      this.initialized = this.request<InitializeResponse>("initialize", params).then((res) => {
        this.notify("initialized");
        return res;
      });
      this.initialized.catch(() => (this.initialized = null));
    }
    return this.initialized;
  }

  async stop() {
    this.starting = null;
    this.initialized = null;
    await transport.stop();
  }

  request<T = Json>(method: string, params?: Json): Promise<T> {
    const id = this.nextId++;
    const line = JSON.stringify({ id, method, params: params ?? {} });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: Json) => void, reject, method });
      transport.send(line).catch((e) => {
        this.pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  notify(method: string, params?: Json) {
    const line = JSON.stringify(params === undefined ? { method } : { method, params });
    return transport.send(line);
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
        await transport.send(JSON.stringify({ id, error: { code: -32601, message: `unhandled server request ${method}` } }));
        return;
      }
      try {
        const result = await handler(msg.params, id);
        await transport.send(JSON.stringify({ id, result }));
      } catch (e) {
        await transport.send(JSON.stringify({ id, error: { code: -32000, message: String(e) } }));
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
