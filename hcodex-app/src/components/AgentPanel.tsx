import { useCallback, useEffect, useRef, useState } from "react";
import {
  agentLabel,
  interrupt,
  loadHistory,
  sendTurn,
  startThread,
  switchProvider,
  useApprovals,
  useError,
  useItems,
  useThread,
  useThreads,
  type Approval,
  type ModelChoice,
  type UiItem,
} from "../lib/store";
import { AgentTree } from "./AgentTree";

type Props = {
  cwd: string;
  choice: ModelChoice;
  /** Main thread of the open session; null before the first message. */
  rootId: string | null;
  /** Thread shown in the transcript: the root, or one of its sub-agents. */
  viewId: string | null;
  onRootChange: (threadId: string | null) => void;
  onViewChange: (threadId: string | null) => void;
  onOpenFile: (path: string) => void;
};

export function AgentPanel({ cwd, choice, rootId, viewId, onRootChange, onViewChange, onOpenFile }: Props) {
  const shownId = viewId ?? rootId;
  const root = useThread(rootId);
  const shown = useThread(shownId);
  const items = useItems(shownId);
  const rootError = useError(rootId);
  const shownError = useError(shownId);
  const approvals = useApprovals(rootId);
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const watchingSub = rootId != null && shownId !== rootId;
  const running = root?.state === "running" || root?.state === "waiting" || busy;

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items, shownId]);

  // A sub-agent's task prompt and earlier turns are only in its saved history.
  useEffect(() => {
    if (watchingSub && shown && !shown.historyLoaded) loadHistory(shown.id);
  }, [watchingSub, shown]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    setLocalError("");
    setBusy(true);
    try {
      let id = rootId;
      if (!id) {
        id = await startThread(cwd, choice);
        onRootChange(id);
      } else if (root && choice.provider && root.provider && choice.provider !== root.provider) {
        // Same conversation, different provider: fork it there and continue.
        id = await switchProvider(id, cwd, choice);
        onRootChange(id);
      }
      onViewChange(null);
      await sendTurn(id, text, choice.model);
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setBusy(false);
    }
  }, [input, running, rootId, root, cwd, choice, onRootChange, onViewChange]);

  const error = localError || shownError || (watchingSub ? "" : rootError);

  return (
    <div className="agent">
      <AgentTree rootId={rootId} viewId={viewId} onSelect={(id) => onViewChange(id === rootId ? null : id)} />

      <div className="agent-header">
        <span className={`dot agent-${shown?.state ?? "idle"}`} />
        {watchingSub && shown ? (
          <>
            <button className="link" onClick={() => onViewChange(null)} title="back to the main thread">
              ← Main
            </button>
            <span className="small grow ellipsis">
              {agentLabel(shown)} <span className="muted">· {shown.model ?? "?"} · watch only</span>
            </span>
          </>
        ) : (
          <span className="small grow ellipsis">{root ? `${root.provider} · ${root.model ?? "?"}` : "new session"}</span>
        )}
        <button className="link" onClick={() => onRootChange(null)} disabled={running}>
          new
        </button>
      </div>
      {error && <div className="error small">{error}</div>}

      <div className="items" ref={listRef}>
        {items.map((ui) => (
          <ItemView key={ui.item.id} ui={ui} onOpenFile={onOpenFile} onOpenAgent={onViewChange} />
        ))}
        {watchingSub && items.length === 0 && <div className="muted small">Nothing from this agent yet.</div>}
      </div>

      {approvals.map((a) => (
        <ApprovalView key={a.key} approval={a} />
      ))}

      <div className="composer">
        <textarea
          value={input}
          disabled={watchingSub}
          placeholder={watchingSub ? "Watching a sub-agent. Go back to Main to send a message." : "Ask Codex… (⌘/Ctrl+Enter)"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send();
          }}
        />
        {running && rootId ? (
          <button onClick={() => interrupt(rootId)}>Stop</button>
        ) : (
          <button onClick={send} disabled={watchingSub}>
            Send
          </button>
        )}
      </div>
    </div>
  );
}

type ItemProps = { ui: UiItem; onOpenFile: (p: string) => void; onOpenAgent: (threadId: string) => void };

function ItemView({ ui, onOpenFile, onOpenAgent }: ItemProps) {
  const { item, stream, done } = ui;
  const threads = useThreads();
  const agentName = (id: string) => (threads[id] ? agentLabel(threads[id]) : `agent ${id.slice(-6)}`);
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
    case "subAgentActivity":
      return (
        <div className="item subagent link-row" onClick={() => onOpenAgent(item.agentThreadId)} title="watch this agent">
          <span className="label">sub-agent {item.kind}</span>{" "}
          <span className="mono small">{item.agentPath || agentName(item.agentThreadId)}</span>
          {item.model && <span className="muted tiny"> · {item.model}</span>}
        </div>
      );
    case "collabAgentToolCall":
      return (
        <div className="item subagent">
          <div className="label">
            {item.tool} <span className="muted">[{item.status}]</span>
          </div>
          {item.receiverThreadIds.map((id) => (
            <div key={id} className="mono small link-row" onClick={() => onOpenAgent(id)} title="watch this agent">
              {agentName(id)}
              {item.agentsStates[id] && <span className="muted"> · {item.agentsStates[id]?.status}</span>}
            </div>
          ))}
          {item.prompt && <pre className="mono small">{item.prompt}</pre>}
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
  const thread = useThread(approval.threadId);
  const who = thread && thread.parentId ? agentLabel(thread) : "Codex";
  return (
    <div className="approval">
      {approval.kind === "command" ? (
        <>
          <div className="label">{who} wants to run:</div>
          <pre className="mono small">{approval.params.command ?? "(command)"}</pre>
        </>
      ) : (
        <div className="label">{who} wants to change files</div>
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
