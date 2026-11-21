import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { rpc } from "../lib/rpc";
import { workspaceDiff, type WorkspaceDiff } from "../lib/git";
import { diffStats, parseDiff, type DiffStats } from "../lib/diff";
import { join, watch, unwatch } from "../lib/fs";
import { PANE_KINDS, paneLabel, setBrowserUrl, type PaneKind, type PaneTab, type Panes } from "../lib/panes";
import type { SessionKind } from "../lib/store";
import { useColorScheme } from "../lib/theme";
import type { FsChangedNotification } from "../protocol/v2/FsChangedNotification";
import { FileIcon, Icon } from "./Icon";
import { AgentTree } from "./AgentTree";
import { Browser } from "./Browser";
import { DiffView } from "./DiffView";
import { Editor, useReloadOnChange, type OpenFile } from "./Editor";
import { FileTree, type TreeChanges } from "./FileTree";
import { Terminal } from "./Terminal";

type Props = {
  kind: SessionKind;
  cwd: string;
  panes: Panes;
  setPanes: Dispatch<SetStateAction<Panes>>;
  /** Open a pane from the "+" menu or the empty pane. */
  onOpenPane: (kind: PaneKind) => void;
  onClosePane: (id: string) => void;
  /** Unified diff of the current turn (from `turn/diff/updated`); used when the folder is not a git repository. */
  turnDiff: string | null;
  /** Bumped when a turn finishes, so the workspace diff is read again. */
  refreshKey: number;
  files: OpenFile[];
  setFiles: Dispatch<SetStateAction<OpenFile[]>>;
  onOpenFile: (path: string) => void;
  rootId: string | null;
  viewId: string | null;
  onSelectAgent: (threadId: string) => void;
};

const WATCH_ID = "ide-root";

/**
 * Watch the workspace folder. The number goes up, debounced, whenever something in it
 * changes, so the explorer and the diff follow edits made through the shell too.
 */
function useWorkspaceVersion(cwd: string, enabled: boolean): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || !cwd) return;
    watch(WATCH_ID, cwd).catch((e) => console.warn("fs/watch failed", e));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = rpc.onNotification("fs/changed", (p) => {
      if ((p as FsChangedNotification).watchId !== WATCH_ID) return;
      clearTimeout(timer);
      timer = setTimeout(() => setVersion((n) => n + 1), 400);
    });
    return () => {
      clearTimeout(timer);
      off();
      unwatch(WATCH_ID);
    };
  }, [cwd, enabled]);
  return version;
}

/** The workspace's uncommitted changes, read again when a turn finishes or a file changes. */
function useWorkspaceDiff(cwd: string, enabled: boolean, refreshKey: number, version: number): WorkspaceDiff | null {
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null);
  useEffect(() => {
    if (!enabled || !cwd) return;
    let live = true;
    workspaceDiff(cwd).then((d) => live && setDiff(d));
    return () => {
      live = false;
    };
  }, [cwd, enabled, refreshKey, version]);
  return diff;
}

/** The panes that can be opened, as a list: the "+" menu, and the whole pane when no tab is open. */
function Launcher({ stats, onPick }: { stats: DiffStats | null; onPick: (kind: PaneKind) => void }) {
  return (
    <div className="launcher" role="menu">
      {PANE_KINDS.map((p) => (
        <button key={p.kind} role="menuitem" className="launch-row" onClick={() => onPick(p.kind)}>
          <Icon name={p.icon} size={16} />
          <span className="launch-label">{p.label}</span>
          {p.kind === "changes" && stats && stats.files > 0 && (
            <span className="launch-stats mono">
              <span className="plus">+{stats.added}</span>
              <span className="minus">−{stats.removed}</span>
            </span>
          )}
          <kbd>{p.keys}</kbd>
        </button>
      ))}
    </div>
  );
}

function tabIcon(tab: PaneTab) {
  if (tab.kind === "file") return <FileIcon name={tab.path} size={14} />;
  const icon = PANE_KINDS.find((p) => p.kind === tab.kind)!.icon;
  return <Icon name={icon} size={14} />;
}

/**
 * Right column. In a Code session: one strip of tabs over the workspace (its uncommitted
 * changes, its files, shells, web pages, and every open file as a tab of its own), with the
 * session's agents listed underneath. A chat session has no workspace and only shows the agents.
 */
export function RightPane(props: Props) {
  const { kind, cwd, panes, setPanes, turnDiff, files, setFiles } = props;
  const scheme = useColorScheme();
  const code = kind === "code";
  const version = useWorkspaceVersion(cwd, code);
  const workspace = useWorkspaceDiff(cwd, code, props.refreshKey, version);
  useReloadOnChange(files, setFiles);

  const fromGit = workspace?.kind === "diff";
  const diffText = fromGit ? workspace.text : turnDiff;
  const diffFiles = useMemo(() => (diffText ? parseDiff(diffText) : []), [diffText]);
  const stats = useMemo(() => (diffText ? diffStats(diffFiles) : null), [diffText, diffFiles]);
  const absolute = (path: string) => (path.startsWith("/") ? path : join(cwd, path));
  const changes = useMemo<TreeChanges>(() => {
    const byPath = new Map(diffFiles.map((f) => [f.path.startsWith("/") ? f.path : join(cwd, f.path), f.status] as const));
    const dirs = new Set<string>();
    for (const path of byPath.keys()) {
      for (let dir = path.slice(0, path.lastIndexOf("/")); dir.length >= cwd.length && !dirs.has(dir); dir = dir.slice(0, dir.lastIndexOf("/"))) dirs.add(dir);
    }
    return { files: byPath, dirs };
  }, [diffFiles, cwd]);

  const active = panes.tabs.find((t) => t.id === panes.active) ?? null;
  const activeFile = active?.kind === "file" ? files.find((f) => f.path === active.path) : undefined;

  // A shell starts the first time its tab is shown, then stays alive while other tabs are in front.
  const [started, setStarted] = useState<string[]>([]);
  if (active?.kind === "terminal" && !started.includes(active.id)) setStarted([...started, active.id]);

  // The shell left in front last time must not take the keyboard from the composer at launch.
  const launched = useRef(false);
  useEffect(() => {
    launched.current = true;
  }, []);

  const [menu, setMenu] = useState<"left" | "right" | null>(null);
  const addRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => !addRef.current?.contains(e.target as Node) && setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // Keep the tab in front visible when the strip scrolls.
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [panes.active, panes.tabs.length]);

  const pick = (k: PaneKind) => {
    setMenu(null);
    props.onOpenPane(k);
  };

  return (
    <aside className="right">
      <div className={code ? "right-code" : "hidden"}>
        <div className="pane-strip">
          <div
            className="pane-tabs"
            role="tablist"
            ref={stripRef}
            onWheel={(e) => {
              // A mouse wheel scrolls the strip sideways.
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY;
            }}
          >
            {panes.tabs.map((t) => {
              const on = t.id === panes.active;
              const file = t.kind === "file" ? files.find((f) => f.path === t.path) : undefined;
              const label = paneLabel(t);
              return (
                <div
                  key={t.id}
                  role="tab"
                  tabIndex={0}
                  aria-selected={on}
                  className={`pane-tab ${on ? "on" : ""}`}
                  title={t.kind === "file" ? t.path : t.kind === "browser" && t.url ? t.url : label}
                  onClick={() => setPanes((p) => ({ ...p, active: t.id }))}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setPanes((p) => ({ ...p, active: t.id }))}
                  onAuxClick={(e) => e.button === 1 && props.onClosePane(t.id)}
                >
                  {tabIcon(t)}
                  <span className="pane-tab-label">{label}</span>
                  {t.kind === "changes" && stats && stats.files > 0 && <span className="count">{stats.files}</span>}
                  {file && file.content !== file.saved && <span className="dirty" title="Unsaved changes" />}
                  <button
                    className="pane-tab-close"
                    title="Close"
                    aria-label={`Close ${label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onClosePane(t.id);
                    }}
                  >
                    <Icon name="x" size={11} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="pane-add" ref={addRef}>
            <button
              className={`icon-btn ${menu ? "on" : ""}`}
              title="Open a pane"
              aria-label="Open a pane"
              aria-haspopup="menu"
              aria-expanded={!!menu}
              onClick={(e) => {
                const box = e.currentTarget.getBoundingClientRect();
                setMenu(menu ? null : box.left + 270 > window.innerWidth ? "right" : "left");
              }}
            >
              <Icon name="plus" size={16} />
            </button>
            {menu && (
              <div className={`pane-menu ${menu}`}>
                <Launcher stats={stats} onPick={pick} />
              </div>
            )}
          </div>
        </div>
        <div className="right-body">
          {!active && (
            <div className="pane-empty">
              <Launcher stats={stats} onPick={pick} />
            </div>
          )}
          {code &&
            active?.kind === "changes" &&
            (diffText ? (
              <DiffView diff={diffText} onOpen={(path) => props.onOpenFile(absolute(path))} />
            ) : (
              <div className="empty small">
                <Icon name="diff" size={22} />
                {fromGit ? "No uncommitted changes in this workspace." : "Not a git repository. Patches the agent applies in a turn show here."}
              </div>
            ))}
          {code && active?.kind === "files" && <FileTree root={cwd} selected={null} onOpen={props.onOpenFile} version={version} changes={changes} />}
          {panes.tabs.map((t) =>
            t.kind === "terminal" && started.includes(t.id) ? (
              <div key={t.id} className={`terminal-host ${t.id === panes.active ? "" : "hidden"}`}>
                <Terminal cwd={cwd} scheme={scheme} active={code && t.id === panes.active} focusOnStart={launched.current} />
              </div>
            ) : t.kind === "browser" ? (
              <div key={t.id} className={`browser-host ${t.id === panes.active ? "" : "hidden"}`}>
                <Browser url={t.url} onUrl={(url) => setPanes((p) => setBrowserUrl(p, t.id, url))} />
              </div>
            ) : null,
          )}
          {activeFile && <Editor root={cwd} file={activeFile} setFiles={setFiles} />}
        </div>
      </div>
      <AgentTree rootId={props.rootId} viewId={props.viewId} onSelect={props.onSelectAgent} />
      {kind === "chat" && <div className="grow" />}
    </aside>
  );
}
