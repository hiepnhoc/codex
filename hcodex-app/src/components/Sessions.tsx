import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rpc } from "../lib/rpc";
import { basename } from "../lib/fs";
import { useThreads, type SessionKind } from "../lib/store";
import { Icon } from "./Icon";
import type { Thread } from "../protocol/v2/Thread";
import type { ThreadListResponse } from "../protocol/v2/ThreadListResponse";

const PAGE = 60;

type Props = {
  kind: SessionKind;
  /** Current workspace (code) — listed first and always shown, even with no sessions yet. */
  cwd: string;
  /** Folder every chat session runs in; its sessions are the chat history. */
  chatDir: string;
  activeRootId: string | null;
  /** Bumped by the app when the list should be fetched again (e.g. a turn finished). */
  refreshKey: number;
  onOpen: (t: Thread) => void;
  onWorkspace: (dir: string) => void;
};

function ago(seconds: number): string {
  const d = Math.max(0, Date.now() / 1000 - seconds);
  if (d < 60) return "now";
  if (d < 3600) return `${Math.floor(d / 60)}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

/** A session's name, else its first message; empty when it has neither yet. */
function title(t: Thread): string {
  return (t.name ?? t.preview ?? "").trim().split("\n")[0];
}

/** Chat history buckets, newest first. */
function dayBucket(seconds: number): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = start.getTime() / 1000;
  if (seconds >= today) return "Today";
  if (seconds >= today - 86400) return "Yesterday";
  if (seconds >= today - 7 * 86400) return "Previous 7 days";
  return "Older";
}

/**
 * Saved sessions. Code: grouped by workspace folder, the current one first.
 * Chat: the sessions of the chat folder, grouped by day.
 */
export function Sessions({ kind, cwd, chatDir, activeRootId, refreshKey, onOpen, onWorkspace }: Props) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");
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
          cwd: kind === "chat" ? chatDir : null,
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
    [search, kind, chatDir],
  );

  useEffect(() => {
    const t = setTimeout(() => load(null), search ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, refreshKey, search]);

  const groups = useMemo(() => {
    const by = new Map<string, Thread[]>();
    if (kind === "code" && cwd) by.set(cwd, []);
    for (const t of threads) {
      if (kind === "code" && t.cwd === chatDir) continue;
      const key = kind === "chat" ? dayBucket(t.updatedAt) : t.cwd;
      const list = by.get(key) ?? [];
      list.push(t);
      by.set(key, list);
    }
    return Array.from(by.entries());
  }, [threads, kind, cwd, chatDir]);

  const addWorkspace = () => {
    const dir = path.trim();
    if (dir) onWorkspace(dir);
    setAdding(false);
    setPath("");
  };

  const toggleSearch = () => {
    if (searching) setSearch("");
    setSearching((s) => !s);
  };

  const row = (t: Thread) => {
    const state = live[t.id]?.state;
    const running = state === "running" || state === "waiting";
    return (
      <div
        key={t.id}
        className={`session-row ${t.id === activeRootId ? "selected" : ""}`}
        title={`${title(t) || "Untitled"}\n${t.modelProvider} · ${t.model ?? "?"}\n${t.cwd}`}
        onClick={() => onOpen(t)}
      >
        <span className={`session-title ${title(t) ? "" : "blank"}`}>{title(t) || "Untitled"}</span>
        {running ? <span className="dot status-running" /> : <span className="session-age">{ago(t.updatedAt)}</span>}
      </div>
    );
  };

  return (
    <div className="sessions">
      <div className="side-heading">
        <span className="grow">{kind === "chat" ? "History" : "Workspaces"}</span>
        <button className={`icon-btn ${searching ? "on" : ""}`} title="Search sessions" aria-label="Search sessions" onClick={toggleSearch}>
          <Icon name="search" size={14} />
        </button>
        {kind === "code" && (
          <button className={`icon-btn ${adding ? "on" : ""}`} title="Open another folder" aria-label="Open another folder" onClick={() => setAdding((a) => !a)}>
            <Icon name="plus" size={14} />
          </button>
        )}
      </div>
      {searching && (
        <div className="search">
          <Icon name="search" size={13} />
          <input
            autoFocus
            value={search}
            placeholder={kind === "chat" ? "Search chats" : "Search sessions"}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && toggleSearch()}
          />
        </div>
      )}
      {kind === "code" && adding && (
        <input
          autoFocus
          className="mono add-folder"
          value={path}
          placeholder={cwd || "/path/to/folder"}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addWorkspace();
            if (e.key === "Escape") setAdding(false);
          }}
          title="Folder path, Enter to open"
        />
      )}
      {error && <div className="error small">{error}</div>}
      <div className="tree-scroll">
        {groups.map(([key, list]) =>
          kind === "chat" ? (
            <div key={key} className="session-group flat">
              <div className="session-day">{key}</div>
              {list.map(row)}
            </div>
          ) : (
            <div key={key} className="session-group">
              <div className={`workspace-row ${key === cwd ? "current" : ""}`} title={key} onClick={() => onWorkspace(key)}>
                <span
                  className={`caret ${collapsed[key] ? "" : "open"}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setCollapsed((c) => ({ ...c, [key]: !c[key] }));
                  }}
                >
                  <Icon name="chevronRight" size={11} />
                </span>
                <span className="folder">
                  <Icon name={collapsed[key] ? "folder" : "folderOpen"} size={15} />
                </span>
                <span className="workspace-name">{basename(key) || key}</span>
                {list.length > 0 && <span className="workspace-count">{list.length}</span>}
              </div>
              {!collapsed[key] && list.map(row)}
              {!collapsed[key] && list.length === 0 && <div className="session-empty">No sessions yet</div>}
            </div>
          ),
        )}
        {!groups.length && !loading && <div className="muted small pad">{kind === "chat" ? "No chats yet." : "No sessions yet."}</div>}
        {cursor && (
          <button className="link small pad" onClick={() => load(cursor)} disabled={loading}>
            {loading ? "loading…" : "load more"}
          </button>
        )}
      </div>
    </div>
  );
}
