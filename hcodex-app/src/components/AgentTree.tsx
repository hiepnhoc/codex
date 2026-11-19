import { useEffect, useState } from "react";
import { agentLabel, useAgentRows, type AgentRow, type AgentState } from "../lib/store";

type Props = {
  rootId: string | null;
  viewId: string | null;
  onSelect: (threadId: string) => void;
};

const STATE_WORD: Record<AgentState, string> = {
  running: "running",
  waiting: "needs approval",
  idle: "idle",
  done: "done",
  error: "error",
  closed: "closed",
  notLoaded: "done",
};

function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** Re-render every second while something is running, so elapsed times tick. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function detail(row: AgentRow, now: number): string {
  const parts = [STATE_WORD[row.state]];
  if (row.model) parts.push(row.model);
  if (row.turnStartedAt) parts.push(elapsed(now - row.turnStartedAt));
  else if (row.lastTurnMs != null) parts.push(elapsed(row.lastTurnMs));
  return parts.join(" · ");
}

/** The main thread and its sub-agents, with live status; click a row to watch that agent. */
export function AgentTree({ rootId, viewId, onSelect }: Props) {
  const rows = useAgentRows(rootId);
  const subs = rows.filter((r) => r.depth > 0);
  const isActive = (r: AgentRow) => r.state === "running" || r.state === "waiting";
  const now = useNow(rows.some(isActive));
  const [open, setOpen] = useState(true);

  if (!rootId || subs.length === 0) return null;

  const running = subs.filter(isActive).length;
  const failed = subs.filter((r) => r.state === "error").length;
  const finished = subs.length - running - failed;
  const summary = [
    running ? `${running} running` : null,
    finished ? `${finished} done` : null,
    failed ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="agents">
      <div className="agents-title" onClick={() => setOpen((o) => !o)}>
        <span className="tree-caret">{open ? "▾" : "▸"}</span>
        Agents <span className="muted">({subs.length})</span>
        <span className="muted tiny agents-summary">{summary}</span>
      </div>
      {open &&
        rows.map((row) => (
          <div
            key={row.id}
            className={`agent-row ${row.id === (viewId ?? rootId) ? "selected" : ""}`}
            style={{ paddingLeft: 8 + row.depth * 14 }}
            onClick={() => onSelect(row.id)}
            title={row.activity}
          >
            <div className="agent-row-head">
              <span className={`dot agent-${row.state}`} />
              <span className="agent-name">{agentLabel(row)}</span>
              <span className="muted tiny agent-detail">{detail(row, now)}</span>
            </div>
            {row.activity && row.depth > 0 && <div className="agent-activity mono tiny muted">{row.activity}</div>}
          </div>
        ))}
    </div>
  );
}
