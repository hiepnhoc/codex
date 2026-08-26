import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "../lib/rpc";
import type { ThreadStartResponse } from "../protocol/v2/ThreadStartResponse";
import type { TurnStartParams } from "../protocol/v2/TurnStartParams";
import type { ThreadItem } from "../protocol/v2/ThreadItem";
import type { ItemStartedNotification } from "../protocol/v2/ItemStartedNotification";
import type { ItemCompletedNotification } from "../protocol/v2/ItemCompletedNotification";
import type { AgentMessageDeltaNotification } from "../protocol/v2/AgentMessageDeltaNotification";
import type { CommandExecutionOutputDeltaNotification } from "../protocol/v2/CommandExecutionOutputDeltaNotification";
import type { TurnCompletedNotification } from "../protocol/v2/TurnCompletedNotification";
import type { TurnDiffUpdatedNotification } from "../protocol/v2/TurnDiffUpdatedNotification";
import type { CommandExecutionRequestApprovalParams } from "../protocol/v2/CommandExecutionRequestApprovalParams";
import type { FileChangeRequestApprovalParams } from "../protocol/v2/FileChangeRequestApprovalParams";

type UiItem = { item: ThreadItem; stream: string; done: boolean };

type Approval =
  | { kind: "command"; params: CommandExecutionRequestApprovalParams; resolve: (d: string) => void }
  | { kind: "file"; params: FileChangeRequestApprovalParams; resolve: (d: string) => void };

export type AgentStatus = "ready" | "running" | "error";

type Props = {
  cwd: string;
  model: string;
  onTurnDiff: (diff: string | null) => void;
  onOpenFile: (path: string) => void;
  onStatus?: (s: AgentStatus, msg?: string) => void;
};

export function AgentPanel({ cwd, model, onTurnDiff, onOpenFile, onStatus }: Props) {
  const [status, setStatus] = useState<AgentStatus>("ready");
  const [thread, setThread] = useState<ThreadStartResponse | null>(null);
  const [items, setItems] = useState<UiItem[]>([]);
  const [approval, setApproval] = useState<Approval | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const setStat = useCallback(
    (s: AgentStatus, msg?: string) => {
      setStatus(s);
      setError(s === "error" ? (msg ?? "error") : "");
      onStatus?.(s, msg);
    },
    [onStatus],
  );

  useEffect(() => {
    const appendStream = (itemId: string, delta: string) =>
      setItems((prev) => {
        const i = prev.findIndex((x) => x.item.id === itemId);
        if (i < 0) return prev;
        const next = prev.slice();
        next[i] = { ...next[i], stream: next[i].stream + delta };
        return next;
      });

    const offs = [
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
      rpc.onNotification("turn/diff/updated", (p) => {
        const { diff } = p as TurnDiffUpdatedNotification;
        onTurnDiff(diff || null);
      }),
      rpc.onNotification("turn/completed", (p) => {
        const { turn } = p as TurnCompletedNotification;
        if (turn.status === "failed") setStat("error", `turn failed: ${turn.error?.message ?? "unknown"}`);
        else setStat("ready");
      }),
    ];

    const ask = (kind: Approval["kind"]) => (params: unknown) =>
      new Promise((resolve) =>
        setApproval({
          kind,
          params: params as never,
          resolve: (decision) => {
            setApproval(null);
            resolve({ decision });
          },
        } as Approval),
      );
    rpc.onServerRequest("item/commandExecution/requestApproval", ask("command"));
    rpc.onServerRequest("item/fileChange/requestApproval", ask("file"));

    return () => offs.forEach((o) => o());
  }, [onTurnDiff, setStat]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items]);

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
    setStat("running");
    onTurnDiff(null);
    try {
      const t = await ensureThread();
      const params: TurnStartParams = {
        threadId: t.thread.id,
        input: [{ type: "text", text, text_elements: [] }],
        model: model || null,
      };
      await rpc.request("turn/start", params);
    } catch (e) {
      setStat("error", String(e));
    }
  }, [input, status, ensureThread, model, onTurnDiff, setStat]);

  const interrupt = useCallback(() => {
    if (thread) rpc.request("turn/interrupt", { threadId: thread.thread.id }).catch(() => {});
  }, [thread]);

  const newThread = () => {
    setThread(null);
    setItems([]);
    onTurnDiff(null);
    setStat("ready");
  };

  return (
    <div className="agent">
      <div className="agent-header">
        <span className={`dot status-${status}`} />
        <span className="small">{thread ? `${thread.modelProvider} · ${thread.model}` : "new thread"}</span>
        <button className="link" onClick={newThread} disabled={status === "running"}>
          new
        </button>
      </div>
      {error && <div className="error small">{error}</div>}

      <div className="items" ref={listRef}>
        {items.map((ui) => (
          <ItemView key={ui.item.id} ui={ui} onOpenFile={onOpenFile} />
        ))}
      </div>

      {approval && <ApprovalView approval={approval} />}

      <div className="composer">
        <textarea
          value={input}
          placeholder="Ask Codex… (⌘/Ctrl+Enter)"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        {status === "running" ? <button onClick={interrupt}>Stop</button> : <button onClick={send}>Send</button>}
      </div>
    </div>
  );
}

function ItemView({ ui, onOpenFile }: { ui: UiItem; onOpenFile: (p: string) => void }) {
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
        <div className="item agent-msg">
          <div className="label">codex{done ? "" : " …"}</div>
          <div className="body">{done ? item.text : stream}</div>
        </div>
      );
    case "reasoning":
      return (
        <details className="item reasoning">
          <summary className="label">thinking</summary>
          <div className="body muted">{item.summary.join("\n")}</div>
        </details>
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
            <div key={c.path} className="mono small link-row" onClick={() => onOpenFile(c.path)} title="open in editor">
              {c.kind.type} {c.path}
            </div>
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
        <details className="item other">
          <summary className="label">{item.type}</summary>
          <pre className="mono tiny">{JSON.stringify(item, null, 1)}</pre>
        </details>
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
        </>
      ) : (
        <div className="label">Codex wants to change files</div>
      )}
      {approval.params.reason && <div className="muted small">{approval.params.reason}</div>}
      <div className="row">
        <button onClick={() => resolve("accept")}>Allow</button>
        <button onClick={() => resolve("acceptForSession")}>Allow for session</button>
        <button className="danger" onClick={() => resolve("decline")}>
          Deny
        </button>
      </div>
    </div>
  );
}
