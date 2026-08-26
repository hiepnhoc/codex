import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { rpc } from "./lib/rpc";
import type { ThreadStartResponse } from "./protocol/v2/ThreadStartResponse";
import type { TurnStartParams } from "./protocol/v2/TurnStartParams";
import type { ModelListResponse } from "./protocol/v2/ModelListResponse";
import type { ConfigReadResponse } from "./protocol/v2/ConfigReadResponse";
import type { ThreadItem } from "./protocol/v2/ThreadItem";
import type { ItemStartedNotification } from "./protocol/v2/ItemStartedNotification";
import type { ItemCompletedNotification } from "./protocol/v2/ItemCompletedNotification";
import type { AgentMessageDeltaNotification } from "./protocol/v2/AgentMessageDeltaNotification";
import type { CommandExecutionOutputDeltaNotification } from "./protocol/v2/CommandExecutionOutputDeltaNotification";
import type { TurnCompletedNotification } from "./protocol/v2/TurnCompletedNotification";
import type { CommandExecutionRequestApprovalParams } from "./protocol/v2/CommandExecutionRequestApprovalParams";
import type { FileChangeRequestApprovalParams } from "./protocol/v2/FileChangeRequestApprovalParams";
import "./app.css";

/** UI-side item: protocol item + streamed text buffer. */
type UiItem = { item: ThreadItem; stream: string; done: boolean };

type Approval =
  | { kind: "command"; params: CommandExecutionRequestApprovalParams; resolve: (d: string) => void }
  | { kind: "file"; params: FileChangeRequestApprovalParams; resolve: (d: string) => void };

type Status = "booting" | "ready" | "running" | "error";

export default function App() {
  const [status, setStatus] = useState<Status>("booting");
  const [statusMsg, setStatusMsg] = useState("starting app-server…");
  const [cwd, setCwd] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [thread, setThread] = useState<ThreadStartResponse | null>(null);
  const [items, setItems] = useState<UiItem[]>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [input, setInput] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  // --- boot: spawn app-server, initialize, load models ---------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await rpc.start();
        setStatusMsg(`app-server pid ${info.pid} (${info.codex_bin}, CODEX_HOME=${info.codex_home ?? "default"})`);
        await rpc.initialize({ name: "codex-ide", title: "Codex IDE", version: "0.1.0" });
        const wd = await invoke<string>("default_cwd");
        setCwd(wd);
        // Configured model (from CODEX_HOME/config.toml) is what the provider actually serves;
        // model/list only knows the built-in OpenAI catalog, so merge both and allow free text.
        const cfg = await rpc.request<ConfigReadResponse>("config/read", { cwd: wd });
        const configured = cfg.config.model ?? "";
        const list = await rpc.request<ModelListResponse>("model/list", { includeHidden: true }).catch(() => null);
        const ids = Array.from(new Set([configured, ...(list?.data.map((m) => m.model) ?? [])].filter(Boolean)));
        if (!cancelled) {
          setModels(ids);
          setModel(configured || ids[0] || "");
          setStatus("ready");
        }
      } catch (e) {
        setStatus("error");
        setStatusMsg(String(e));
      }
    })();

    const offs = [
      rpc.onLog((l) => setLogs((prev) => [...prev.slice(-200), l])),
      rpc.onExit(() => {
        setStatus("error");
        setStatusMsg("app-server exited");
      }),
      rpc.onNotification("item/started", (p) => {
        const { item } = p as ItemStartedNotification;
        setItems((prev) => [...prev, { item, stream: "", done: false }]);
      }),
      rpc.onNotification("item/completed", (p) => {
        const { item } = p as ItemCompletedNotification;
        setItems((prev) => {
          const i = prev.findIndex((x) => x.item.id === item.id);
          if (i < 0) return [...prev, { item, stream: "", done: true }];
          const next = prev.slice();
          next[i] = { ...next[i], item, done: true };
          return next;
        });
      }),
      rpc.onNotification("item/agentMessage/delta", (p) => {
        const { itemId, delta } = p as AgentMessageDeltaNotification;
        appendStream(itemId, delta);
      }),
      rpc.onNotification("item/commandExecution/outputDelta", (p) => {
        const { itemId, delta } = p as CommandExecutionOutputDeltaNotification;
        appendStream(itemId, delta);
      }),
      rpc.onNotification("turn/completed", (p) => {
        const { turn } = p as TurnCompletedNotification;
        setStatus("ready");
        if (turn.status === "failed") setStatusMsg(`turn failed: ${turn.error?.message ?? "unknown"}`);
      }),
    ];

    // server -> client approval requests
    rpc.onServerRequest("item/commandExecution/requestApproval", (params) =>
      new Promise((resolve) =>
        setApproval({
          kind: "command",
          params: params as CommandExecutionRequestApprovalParams,
          resolve: (decision) => {
            setApproval(null);
            resolve({ decision });
          },
        }),
      ),
    );
    rpc.onServerRequest("item/fileChange/requestApproval", (params) =>
      new Promise((resolve) =>
        setApproval({
          kind: "file",
          params: params as FileChangeRequestApprovalParams,
          resolve: (decision) => {
            setApproval(null);
            resolve({ decision });
          },
        }),
      ),
    );

    return () => {
      cancelled = true;
      offs.forEach((o) => o());
    };
  }, []);

  function appendStream(itemId: string, delta: string) {
    setItems((prev) => {
      const i = prev.findIndex((x) => x.item.id === itemId);
      if (i < 0) return prev;
      const next = prev.slice();
      next[i] = { ...next[i], stream: next[i].stream + delta };
      return next;
    });
  }

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items]);

  // --- actions --------------------------------------------------------------
  const ensureThread = useCallback(async () => {
    if (thread) return thread;
    const t = await rpc.request<ThreadStartResponse>("thread/start", {
      cwd,
      model: model || null,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    setThread(t);
    return t;
  }, [thread, cwd, model]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || status === "running") return;
    setInput("");
    setStatus("running");
    try {
      const t = await ensureThread();
      const params: TurnStartParams = {
        threadId: t.thread.id,
        input: [{ type: "text", text, text_elements: [] }],
        model: model || null,
      };
      await rpc.request("turn/start", params);
    } catch (e) {
      setStatus("error");
      setStatusMsg(String(e));
    }
  }, [input, status, ensureThread, model]);

  const interrupt = useCallback(async () => {
    if (!thread) return;
    await rpc.request("turn/interrupt", { threadId: thread.thread.id }).catch(() => {});
  }, [thread]);

  const newThread = useCallback(() => {
    setThread(null);
    setItems([]);
  }, []);

  // --- render ---------------------------------------------------------------
  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-title">Codex IDE</div>
        <div className="muted small">cwd</div>
        <input className="mono small" value={cwd} onChange={(e) => setCwd(e.target.value)} disabled={!!thread} />
        <div className="muted small">model</div>
        <input className="mono small" list="models" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" />
        <datalist id="models">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <button onClick={newThread} disabled={status === "running"}>
          New thread
        </button>
        <div className="muted small" style={{ marginTop: "auto" }}>
          {thread ? `provider: ${thread.modelProvider} · thread ${thread.thread.id.slice(0, 8)}` : "no thread"}
        </div>
        <details className="logs">
          <summary className="muted small">server logs ({logs.length})</summary>
          <pre className="mono tiny">{logs.slice(-40).join("\n")}</pre>
        </details>
      </aside>

      <main className="main">
        <div className={`statusbar status-${status}`}>
          <span className="dot" /> {status} — <span className="mono small">{statusMsg}</span>
        </div>

        <div className="items" ref={listRef}>
          {items.map((ui) => (
            <ItemView key={ui.item.id} ui={ui} />
          ))}
        </div>

        {approval && <ApprovalView approval={approval} />}

        <div className="composer">
          <textarea
            value={input}
            placeholder={status === "ready" ? "Ask Codex… (⌘/Ctrl+Enter to send)" : status}
            disabled={status !== "ready" && status !== "running"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
            }}
          />
          {status === "running" ? (
            <button onClick={interrupt}>Stop</button>
          ) : (
            <button onClick={send} disabled={status !== "ready"}>
              Send
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function ItemView({ ui }: { ui: UiItem }) {
  const { item, stream, done } = ui;
  switch (item.type) {
    case "userMessage":
      return (
        <div className="item user">
          <div className="label">you</div>
          <div className="body">{item.content.map((c) => ("text" in c ? c.text : `[${c.type}]`)).join("")}</div>
        </div>
      );
    case "agentMessage":
      return (
        <div className="item agent">
          <div className="label">codex{done ? "" : " …"}</div>
          <div className="body">{done ? item.text : stream}</div>
        </div>
      );
    case "reasoning":
      return (
        <div className="item reasoning">
          <div className="label">thinking</div>
          <div className="body muted">{item.summary.join("\n")}</div>
        </div>
      );
    case "commandExecution":
      return (
        <div className="item command">
          <div className="label">
            $ <span className="mono">{item.command}</span> <span className="muted">[{item.status}]</span>
          </div>
          <pre className="mono small">{done ? (item.aggregatedOutput ?? stream) : stream}</pre>
        </div>
      );
    case "fileChange":
      return (
        <div className="item filechange">
          <div className="label">
            file change <span className="muted">[{item.status}]</span>
          </div>
          {item.changes.map((c) => (
            <details key={c.path}>
              <summary className="mono small">
                {c.kind.type} {c.path}
              </summary>
              <pre className="mono tiny diff">{c.diff}</pre>
            </details>
          ))}
        </div>
      );
    case "plan":
      return (
        <div className="item plan">
          <div className="label">plan</div>
          <pre className="body">{item.text}</pre>
        </div>
      );
    default:
      return (
        <div className="item other">
          <div className="label">{item.type}</div>
          <pre className="mono tiny">{JSON.stringify(item, null, 1)}</pre>
        </div>
      );
  }
}

function ApprovalView({ approval }: { approval: Approval }) {
  const { resolve } = approval;
  return (
    <div className="approval">
      {approval.kind === "command" ? (
        <>
          <div className="label">Codex wants to run:</div>
          <pre className="mono small">{approval.params.command ?? "(command)"}</pre>
          {approval.params.reason && <div className="muted small">{approval.params.reason}</div>}
        </>
      ) : (
        <>
          <div className="label">Codex wants to change files</div>
          {approval.params.reason && <div className="muted small">{approval.params.reason}</div>}
        </>
      )}
      <div className="row">
        <button onClick={() => resolve("accept")}>Allow once</button>
        <button onClick={() => resolve("acceptForSession")}>Allow for session</button>
        <button className="danger" onClick={() => resolve("decline")}>
          Deny
        </button>
      </div>
    </div>
  );
}
