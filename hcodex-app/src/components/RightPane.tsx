import { useEffect, useRef, useState } from "react";
import { rpc } from "../lib/rpc";
import { workspaceDiff, type WorkspaceDiff } from "../lib/git";
import type { SessionKind } from "../lib/store";
import { join } from "../lib/fs";
import { useColorScheme } from "../lib/theme";
import { Icon, type IconName } from "./Icon";
import { AgentTree } from "./AgentTree";
import { DiffView } from "./DiffView";
import { Editor, type Tab } from "./Editor";
import { FileTree } from "./FileTree";
import { Resizer, clamp, useStoredWidth } from "./Resizer";
import { Terminal } from "./Terminal";

export type RightTab = "changes" | "files" | "terminal";

type Props = {
  kind: SessionKind;
  cwd: string;
  tab: RightTab;
  onTab: (t: RightTab) => void;
  /** Unified diff of the current turn (from `turn/diff/updated`); used when the folder is not a git repository. */
  turnDiff: string | null;
  /** Bumped when a turn finishes, so the workspace diff is read again. */
  refreshKey: number;
  files: Tab[];
  activeFile: string | null;
  onFilesChange: (tabs: Tab[]) => void;
  onActivateFile: (path: string | null) => void;
  onOpenFile: (path: string) => void;
  rootId: string | null;
  viewId: string | null;
  onSelectAgent: (threadId: string) => void;
};

const TREE_DEFAULT = 190;

const TABS: Array<{ id: RightTab; label: string; icon: IconName }> = [
  { id: "changes", label: "Changes", icon: "diff" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
];

/**
 * The workspace's uncommitted changes. Re-read when a turn finishes and, debounced, whenever
 * a watched file changes, so edits the agent makes through the shell show up too.
 */
function useWorkspaceDiff(cwd: string, enabled: boolean, refreshKey: number): WorkspaceDiff | null {
  const [diff, setDiff] = useState<WorkspaceDiff | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = rpc.onNotification("fs/changed", () => {
      clearTimeout(timer);
      timer = setTimeout(() => setTick((n) => n + 1), 600);
    });
    return () => {
      clearTimeout(timer);
      off();
    };
  }, []);

  useEffect(() => {
    if (!enabled || !cwd) return;
    let live = true;
    workspaceDiff(cwd).then((d) => live && setDiff(d));
    return () => {
      live = false;
    };
  }, [cwd, enabled, refreshKey, tick]);

  return diff;
}

/**
 * Right column: everything about the workspace's files (the turn's diff, the explorer and
 * editor, a shell), with the session's agents listed underneath. A chat session has no
 * workspace, so it only shows the agents.
 */
export function RightPane(props: Props) {
  const { kind, cwd, tab, onTab, turnDiff } = props;
  const scheme = useColorScheme();
  // The shell is started the first time its tab is opened, then kept alive while hidden.
  const [terminalOpened, setTerminalOpened] = useState(tab === "terminal");
  if (tab === "terminal" && !terminalOpened) setTerminalOpened(true);
  const [treeWidth, setTreeWidth] = useStoredWidth("hcodex.treeWidth", TREE_DEFAULT);
  const filesRef = useRef<HTMLDivElement>(null);
  const workspace = useWorkspaceDiff(cwd, kind === "code", props.refreshKey);
  const fromGit = workspace?.kind === "diff";
  const diffText = fromGit ? workspace.text : turnDiff;

  return (
    <aside className="right">
      <div className={kind === "code" ? "right-code" : "hidden"}>
          <div className="right-tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => onTab(t.id)}>
                <Icon name={t.icon} size={15} />
                {t.label}
                {t.id === "changes" && fromGit && workspace.files > 0 && <span className="count">{workspace.files}</span>}
                {t.id === "changes" && !fromGit && turnDiff && <span className="dot status-running still" />}
              </button>
            ))}
          </div>
          <div className="right-body">
            {kind === "code" &&
              tab === "changes" &&
              (diffText ? (
                <DiffView diff={diffText} onOpen={(path) => props.onOpenFile(path.startsWith("/") ? path : join(cwd, path))} />
              ) : (
                <div className="empty small">
                  <Icon name="diff" size={22} />
                  {fromGit ? "No uncommitted changes in this workspace." : "Not a git repository. Patches the agent applies in a turn show here."}
                </div>
              ))}
            {kind === "code" && tab === "files" && (
              <div className="files" ref={filesRef} style={{ gridTemplateColumns: `${treeWidth}px minmax(0, 1fr)` }}>
                <div className="files-tree-host">
                  <div className="files-tree">
                    <FileTree root={cwd} selected={props.activeFile} onOpen={props.onOpenFile} />
                  </div>
                  <Resizer
                    edge="right"
                    onDrag={(x) => {
                      const box = filesRef.current?.getBoundingClientRect();
                      if (box) setTreeWidth(clamp(x - box.left, 110, box.width - 160));
                    }}
                    onReset={() => setTreeWidth(TREE_DEFAULT)}
                  />
                </div>
                <Editor root={cwd} tabs={props.files} active={props.activeFile} onTabsChange={props.onFilesChange} onActivate={props.onActivateFile} />
              </div>
            )}
            {terminalOpened && (
              <div className={`terminal-host ${tab === "terminal" ? "" : "hidden"}`}>
                <Terminal cwd={cwd} scheme={scheme} />
              </div>
            )}
          </div>
      </div>
      <AgentTree rootId={props.rootId} viewId={props.viewId} onSelect={props.onSelectAgent} />
      {kind === "chat" && <div className="grow" />}
    </aside>
  );
}
