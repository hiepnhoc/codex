import { useState, type ReactNode } from "react";
import type { SessionKind } from "../lib/store";
import type { Thread } from "../protocol/v2/Thread";
import { Icon, type IconName } from "./Icon";
import { Sessions } from "./Sessions";

export type Page = "plugins" | "skills" | "mcp" | "providers";

const NAV: Array<{ page: Page; label: string; icon: IconName }> = [
  { page: "plugins", label: "Plugins", icon: "plug" },
  { page: "skills", label: "Skills", icon: "book" },
  { page: "mcp", label: "MCP servers", icon: "tool" },
  { page: "providers", label: "Providers", icon: "server" },
];

type Props = {
  kind: SessionKind;
  onKind: (k: SessionKind) => void;
  cwd: string;
  chatDir: string;
  activeRootId: string | null;
  refreshKey: number;
  page: Page | null;
  onPage: (p: Page | null) => void;
  onOpen: (t: Thread) => void;
  onNew: () => void;
  onWorkspace: (dir: string) => void;
  footer: string;
  /** Drag handle on the sidebar's right edge. */
  resizer: ReactNode;
};

/** Left column: Chat/Code switch, new session, extensions, then workspaces or chat history. */
export function Sidebar(props: Props) {
  const { kind, onKind, cwd, page, onPage, onNew, onWorkspace } = props;
  const [adding, setAdding] = useState(false);
  const [path, setPath] = useState("");

  const addWorkspace = () => {
    const dir = path.trim();
    if (dir) onWorkspace(dir);
    setAdding(false);
    setPath("");
  };

  return (
    <aside className="sidebar">
      <div className="brand">hcodex</div>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={kind === "chat"} className={kind === "chat" ? "on" : ""} onClick={() => onKind("chat")}>
          <Icon name="chat" size={14} /> Chat
        </button>
        <button role="tab" aria-selected={kind === "code"} className={kind === "code" ? "on" : ""} onClick={() => onKind("code")}>
          <Icon name="code" size={14} /> Code
        </button>
      </div>

      <button className="new-session" onClick={onNew}>
        <Icon name="plus" size={14} /> {kind === "chat" ? "New chat" : "New session"}
      </button>

      <nav className="nav">
        {NAV.map((n) => (
          <div key={n.page} className={`nav-row ${page === n.page ? "selected" : ""}`} onClick={() => onPage(page === n.page ? null : n.page)}>
            <Icon name={n.icon} /> {n.label}
          </div>
        ))}
      </nav>

      <div className="side-heading">
        <span>{kind === "chat" ? "History" : "Workspaces"}</span>
        {kind === "code" && (
          <button className="icon-btn" title="Open another folder" aria-label="Open another folder" onClick={() => setAdding((a) => !a)}>
            <Icon name="plus" size={13} />
          </button>
        )}
      </div>
      {kind === "code" && adding && (
        <input
          autoFocus
          className="mono small"
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

      <Sessions
        kind={kind}
        cwd={cwd}
        chatDir={props.chatDir}
        activeRootId={props.activeRootId}
        refreshKey={props.refreshKey}
        onOpen={props.onOpen}
        onWorkspace={onWorkspace}
      />

      <div className="side-footer muted tiny" title={props.footer}>
        {props.footer}
      </div>
      {props.resizer}
    </aside>
  );
}
