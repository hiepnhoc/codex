import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rpc } from "../lib/rpc";
import { basename } from "../lib/fs";
import { useThreads } from "../lib/store";
import type { Thread } from "../protocol/v2/Thread";
import type { ThreadListResponse } from "../protocol/v2/ThreadListResponse";

const PAGE = 60;

type Props = {
  cwd: string;
  activeRootId: string | null;
  /** Bumped by the app when the list should be fetched again (e.g. a turn finished). */
  refreshKey: number;
  onOpen: (t: Thread) => void;
  onNew: () => void;
};

function ago(seconds: number): string {
  const d = Math.max(0, Date.now() / 1000 - seconds);
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

function title(t: Thread): string {
  return (t.name ?? t.preview ?? "").trim().split("\n")[0] || "(untitled)";
}

/** Saved sessions grouped by project folder; the current workspace comes first. */
export function Sessions({ cwd, activeRootId, refreshKey, onOpen, onNew }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const live = useThreads();
  const request = useRef(0);

  const load = useCallback(
    async (after: string | null) => {
      const mine = ++request.current;
      setLoading(true);
      try {
        const r = await rpc.request<ThreadListResponse>("thread/list", {
          limit: PAGE,
          sortKey: "updated_at",
          cursor: after,
          searchTerm: search.trim() || null,
          // Omitted, this filter defaults to the default provider and hides every other session.
          modelProviders: [],
        });
        if (mine !== request.current) return;
        setThreads((prev) => (after ? [...prev, ...r.data] : r.data));
        setCursor(r.nextCursor);
        setError("");
      } catch (e) {
        if (mine === request.current) setError(String(e));
      } finally {
        if (mine === request.current) setLoading(false);
      }
    },
    [search],
  );

  useEffect(() => {
    const t = setTimeout(() => load(null), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, refreshKey, search]);

  const groups = useMemo(() => {
    const by = new Map<string, Thread[]>();
    for (const t of threads) {
      const list = by.get(t.cwd) ?? [];
      list.push(t);
      by.set(t.cwd, list);
    }
    return Array.from(by.entries()).sort(([a], [b]) => (a === cwd ? -1 : b === cwd ? 1 : 0));
  }, [threads, cwd]);

  return (
    <div className="sessions">
      <div className="row">
        <input
          className="small grow"
          value={search}
          placeholder="Search sessions"
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="small" onClick={onNew} title="new session in this workspace">
          New
        </button>
      </div>
      {error && <div className="error small">{error}</div>}
      <div className="tree-scroll">
        {groups.map(([dir, list]) => (
          <div key={dir} className="session-group">
            <div
              className={`session-group-title ${dir === cwd ? "current" : ""}`}
              title={dir}
              onClick={() => setCollapsed((c) => ({ ...c, [dir]: !c[dir] }))}
            >
              <span className="tree-caret">{collapsed[dir] ? "▸" : "▾"}</span>
              {basename(dir) || dir}
              <span className="muted tiny"> {list.length}</span>
            </div>
            {!collapsed[dir] &&
              list.map((t) => {
                const state = live[t.id]?.state;
                const running = state === "running" || state === "waiting";
                return (
                  <div
                    key={t.id}
                    className={`session-row ${t.id === activeRootId ? "selected" : ""}`}
                    title={`${title(t)}\n${t.modelProvider} · ${t.model ?? "?"}\n${t.cwd}`}
                    onClick={() => onOpen(t)}
                  >
                    <span className={`dot ${running ? "status-running" : t.id === activeRootId ? "status-ready" : ""}`} />
                    <span className="session-title">{title(t)}</span>
                    <span className="muted tiny">{ago(t.updatedAt)}</span>
                  </div>
                );
              })}
          </div>
        ))}
        {!threads.length && !loading && <div className="muted small pad">No sessions yet.</div>}
        {cursor && (
          <button className="link small pad" onClick={() => load(cursor)} disabled={loading}>
            {loading ? "loading…" : "load more"}
          </button>
        )}
      </div>
    </div>
  );
}
