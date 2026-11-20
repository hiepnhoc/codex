import { useCallback, useEffect, useRef, useState } from "react";
import {
  agentLabel,
  displayCommand,
  interrupt,
  loadHistory,
  sendTurn,
  startThread,
  switchProvider,
  useAgentRows,
  useApprovals,
  useError,
  useItems,
  useThread,
  useThreads,
  useUsage,
  type Approval,
  type ModelChoice,
  type SessionKind,
  type UiItem,
} from "../lib/store";
import { basename } from "../lib/fs";
import type { Catalog } from "../lib/models";
import { FileIcon, Icon, Logo } from "./Icon";
import { Markdown } from "./Markdown";
import { ModelPicker } from "./ModelPicker";

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

type Props = {
  kind: SessionKind;
  /** Folder the session runs in: the workspace, or the chat folder. */
  cwd: string;
  catalog: Catalog;
  choice: ModelChoice;
  onChoice: (c: ModelChoice) => void;
  /** Main thread of the open session; null before the first message. */
  rootId: string | null;
  /** Thread shown in the transcript: the root, or one of its sub-agents. */
  viewId: string | null;
  onRootChange: (threadId: string | null) => void;
  onViewChange: (threadId: string | null) => void;
  onOpenFile: (path: string) => void;
  rightOpen: boolean;
  onToggleRight: () => void;
  onShowAgents: () => void;
};

/** Centre column: one conversation, with the agent's work shown as compact activity lines. */
export function ChatPane(props: Props) {
  const { kind, cwd, choice, rootId, viewId, onRootChange, onViewChange, onOpenFile } = props;
  const shownId = viewId ?? rootId;
  const root = useThread(rootId);
  const shown = useThread(shownId);
  const items = useItems(shownId);
  const rootItems = useItems(rootId);
  const rootError = useError(rootId);
  const shownError = useError(shownId);
  const approvals = useApprovals(rootId);
  const usage = useUsage(rootId);
  const agents = useAgentRows(rootId).filter((r) => r.depth > 0);
  const [input, setInput] = useState("");
  const [localError, setLocalError] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const watchingSub = rootId != null && shownId !== rootId;
  const running = root?.state === "running" || root?.state === "waiting" || busy;
  const switching = !!(root && choice.provider && root.provider && choice.provider !== root.provider);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [items, shownId]);

  // A sub-agent's task prompt and earlier turns are only in its saved history.
  useEffect(() => {
    if (watchingSub && shown && !shown.historyLoaded) loadHistory(shown.id);
  }, [watchingSub, shown]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || running || watchingSub) return;
    setInput("");
    setLocalError("");
    setBusy(true);
    try {
      const opts = { kind, defaultProvider: props.catalog.providers[0]?.id ?? "" };
      let id = rootId;
      if (!id) {
        id = await startThread(cwd, choice, opts);
        onRootChange(id);
      } else if (switching) {
        // Same conversation, different provider: fork it there and continue.
        id = await switchProvider(id, cwd, choice, opts);
        onRootChange(id);
      }
      onViewChange(null);
      await sendTurn(id, text, choice.model);
    } catch (e) {
      setLocalError(String(e));
    } finally {
      setBusy(false);
    }
  }, [input, running, watchingSub, rootId, switching, cwd, choice, kind, props.catalog, onRootChange, onViewChange]);

  const error = localError || shownError || (watchingSub ? "" : rootError);
  // A thread gets its server-side title after the first turn; until then use the first message.
  const firstMessage = rootItems.find((x) => x.item.type === "userMessage")?.item;
  const firstText = firstMessage?.type === "userMessage" ? firstMessage.content.map((c) => ("text" in c ? c.text : "")).join("").trim().split("\n")[0] : "";
  const title = root?.title && root.title !== "(untitled)" ? root.title : firstText || (kind === "chat" ? "New chat" : "New session");
  const active = agents.filter((a) => a.state === "running" || a.state === "waiting").length;
  const finished = agents.length - active;
  const percent = usage?.window ? Math.min(100, Math.round((usage.used / usage.window) * 100)) : null;
  // The agent is busy but nothing is streaming: between a tool result and the next answer.
  const shownRunning = watchingSub ? shown?.state === "running" : running;
  const waiting = shownRunning && (items.length === 0 || items[items.length - 1].done);

  return (
    <section className="chat">
      <header className="chat-header">
        {watchingSub && shown ? (
          <>
            <button className="ghost" onClick={() => onViewChange(null)} title="Back to the main thread">
              <Icon name="back" /> Main
            </button>
            <span className="chat-title ellipsis">
              {agentLabel(shown)} <span className="muted">· {shown.model ?? "?"} · watch only</span>
            </span>
          </>
        ) : (
          <span className="chat-title ellipsis">{title}</span>
        )}
        {agents.length > 0 && (
          <button className={`pill ${active ? "live" : ""}`} onClick={props.onShowAgents} title="Show the agents of this session">
            <Icon name="agent" size={14} />
            {active ? `${active} subagent${active > 1 ? "s" : ""} running` : `${agents.length} subagent${agents.length > 1 ? "s" : ""}`}
            {active > 0 && finished > 0 && <span className="muted"> · {finished} done</span>}
          </button>
        )}
        <span className="grow" />
        {kind === "code" && (
          <button className="icon-btn" onClick={props.onToggleRight} title={props.rightOpen ? "Hide the side pane" : "Show files, changes and terminal"} aria-label="Toggle side pane">
            <Icon name="panel" />
          </button>
        )}
      </header>

      <div className="items" ref={listRef}>
        <div className="items-inner">
          {items.length === 0 && !watchingSub && (
            <div className="welcome">
              <Logo size={40} />
              <div className="welcome-title">{kind === "chat" ? "Ask anything" : "What should we work on?"}</div>
              <div className="welcome-sub">
                {kind === "chat" ? (
                  "Chat is read-only: nothing here changes your files."
                ) : (
                  <>
                    <Icon name="folder" size={14} /> {basename(cwd) || cwd}
                  </>
                )}
              </div>
            </div>
          )}
          {watchingSub && items.length === 0 && <div className="muted small">Nothing from this agent yet.</div>}
          {items.map((ui) => (
            <ItemView key={ui.item.id} ui={ui} onOpenFile={onOpenFile} onOpenAgent={onViewChange} />
          ))}
          {waiting && (
            <div className="working" aria-live="polite">
              <i />
              <i />
              <i />
              Working
            </div>
          )}
          {error && <div className="error small">{error}</div>}
        </div>
      </div>

      <div className="composer-wrap">
        {approvals.map((a) => (
          <ApprovalView key={a.key} approval={a} />
        ))}
        <div className={`composer ${watchingSub ? "disabled" : ""}`}>
          <textarea
            value={input}
            disabled={watchingSub}
            rows={2}
            placeholder={watchingSub ? "Watching a sub-agent. Go back to Main to send a message." : kind === "chat" ? "Message hcodex" : "Message or give a task"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter adds a line. Ignore Enter while an IME is composing.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="composer-bar">
            <ModelPicker catalog={props.catalog} value={choice} onChange={props.onChoice} />
            {switching && (
              <span className="tiny warn" title="The next message continues this conversation on the new provider">
                switches provider
              </span>
            )}
            <span className="grow" />
            {running && rootId ? (
              <button className="send stop" onClick={() => interrupt(rootId)} title="Stop" aria-label="Stop">
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button className="send" onClick={send} disabled={watchingSub || !input.trim()} title="Send (Enter)" aria-label="Send">
                <Icon name="up" size={14} />
              </button>
            )}
          </div>
        </div>
        <div className="composer-status">
          <span className="ellipsis">
            {kind === "chat" ? "Read-only: answers without touching your files" : "Edits stay inside the workspace; anything else asks first"}
          </span>
          <span className="grow" />
          {usage && <span>{compact(usage.used)} tokens</span>}
          {percent != null && (
            <>
              <span className={`meter ${percent >= 80 ? "high" : ""}`} title={`${percent}% of the context window used`}>
                <i style={{ width: `${percent}%` }} />
              </span>
              <span>{percent}%</span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-btn"
      title="Copy"
      aria-label="Copy the answer"
      onClick={() =>
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => {},
        )
      }
    >
      <Icon name={copied ? "check" : "copy"} size={14} />
    </button>
  );
}

const Caret = () => (
  <span className="caret">
    <Icon name="chevronRight" size={11} />
  </span>
);

type ItemProps = { ui: UiItem; onOpenFile: (p: string) => void; onOpenAgent: (threadId: string) => void };

/** Added and removed line counts of a unified diff. */
function diffStat(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  return { added, removed };
}

const CHANGE_WORD = { add: "Created", delete: "Deleted", update: "Edited" } as const;

function ItemView({ ui, onOpenFile, onOpenAgent }: ItemProps) {
  const { item, stream, done } = ui;
  const threads = useThreads();
  const agentName = (id: string) => (threads[id] ? agentLabel(threads[id]) : `agent ${id.slice(-6)}`);
  switch (item.type) {
    case "userMessage":
      return <div className="msg user">{item.content.map((c) => ("text" in c ? c.text : `[${c.type}]`)).join("")}</div>;
    case "agentMessage":
      return (
        <div className="msg assistant">
          <Markdown text={done ? item.text : stream} />
          {done && item.text && (
            <div className="msg-actions">
              <CopyButton text={item.text} />
            </div>
          )}
        </div>
      );
    case "reasoning":
      return item.summary.length ? (
        <details className="act">
          <summary>
            <Icon name="spark" size={14} /> Thought <Caret />
          </summary>
          <div className="act-body muted">{item.summary.join("\n")}</div>
        </details>
      ) : null;
    case "commandExecution": {
      const output = done ? (item.aggregatedOutput ?? stream) : stream;
      return (
        <details className="act">
          <summary>
            <Icon name="terminal" size={14} />
            <span className="mono ellipsis" title={item.command}>
              {displayCommand(item.command)}
            </span>
            {item.status !== "completed" && <span className="muted"> {item.status === "inProgress" ? "running…" : item.status}</span>}
          </summary>
          {output && <pre className="act-body mono">{output}</pre>}
        </details>
      );
    }
    case "fileChange":
      return (
        <>
          {item.changes.map((c) => {
            const { added, removed } = diffStat(c.diff);
            return (
              <div key={c.path} className="file-card" onClick={() => onOpenFile(c.path)} title={`Open ${c.path}`}>
                <span className="tile">
                  <FileIcon name={c.path} />
                </span>
                <span className="muted">{CHANGE_WORD[c.kind.type]}</span>
                <span className="name ellipsis">{basename(c.path)}</span>
                {added > 0 && <span className="plus">+{added}</span>}
                {removed > 0 && <span className="minus">-{removed}</span>}
                {item.status !== "completed" && <span className="muted">{item.status === "inProgress" ? "applying…" : item.status}</span>}
              </div>
            );
          })}
        </>
      );
    case "plan":
      return (
        <details className="act" open>
          <summary>
            <Icon name="list" size={14} /> Plan <Caret />
          </summary>
          <pre className="act-body">{item.text}</pre>
        </details>
      );
    case "subAgentActivity":
      return (
        <div className="act link" onClick={() => onOpenAgent(item.agentThreadId)} title="Watch this agent">
          <Icon name="agent" size={14} />
          Sub-agent {item.kind} <span className="mono">{item.agentPath || agentName(item.agentThreadId)}</span>
          {item.model && <span className="muted"> · {item.model}</span>}
        </div>
      );
    case "collabAgentToolCall":
      return (
        <>
          {item.receiverThreadIds.map((id) => (
            <div key={id} className="act link" onClick={() => onOpenAgent(id)} title="Watch this agent">
              <Icon name="agent" size={14} />
              {item.tool} <span className="mono">{agentName(id)}</span>
              {item.agentsStates[id] && <span className="muted"> · {item.agentsStates[id]?.status}</span>}
            </div>
          ))}
          {item.receiverThreadIds.length === 0 && (
            <div className="act">
              <Icon name="agent" size={14} />
              {item.tool} <span className="muted">{item.status === "inProgress" ? "…" : item.status}</span>
            </div>
          )}
        </>
      );
    case "mcpToolCall":
      return (
        <div className="act">
          <Icon name="tool" size={14} />
          Tool <span className="mono">{item.server}.{item.tool}</span>
          {item.status !== "completed" && <span className="muted"> {item.status}</span>}
        </div>
      );
    default:
      return (
        <details className="act">
          <summary>
            <Icon name="tool" size={14} /> {item.type} <Caret />
          </summary>
          <pre className="act-body mono">{JSON.stringify(item, null, 1)}</pre>
        </details>
      );
  }
}

function ApprovalView({ approval }: { approval: Approval }) {
  const { resolve } = approval;
  const thread = useThread(approval.threadId);
  const who = thread && thread.parentId ? agentLabel(thread) : "hcodex";
  return (
    <div className="approval">
      {approval.kind === "command" ? (
        <>
          <div className="small">{who} wants to run:</div>
          <pre className="mono small">{approval.params.command ?? "(command)"}</pre>
        </>
      ) : (
        <div className="small">{who} wants to change files</div>
      )}
      {approval.params.reason && <div className="muted small">{approval.params.reason}</div>}
      <div className="row">
        <button className="primary" onClick={() => resolve("accept")}>
          Allow
        </button>
        <button onClick={() => resolve("acceptForSession")}>Allow for session</button>
        <button className="danger" onClick={() => resolve("decline")}>
          Deny
        </button>
      </div>
    </div>
  );
}
