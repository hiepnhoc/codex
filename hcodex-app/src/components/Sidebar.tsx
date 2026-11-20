import type { ReactNode } from "react";
import type { SessionKind } from "../lib/store";
import type { Thread } from "../protocol/v2/Thread";
import { Icon, Logo, type IconName } from "./Icon";
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
  const { kind, onKind, page, onPage, onNew } = props;

  return (
    <aside className="sidebar">
      <div className="brand">
        <Logo /> hcodex
      </div>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={kind === "chat"} className={kind === "chat" ? "on" : ""} onClick={() => onKind("chat")}>
          <Icon name="chat" size={14} /> Chat
        </button>
        <button role="tab" aria-selected={kind === "code"} className={kind === "code" ? "on" : ""} onClick={() => onKind("code")}>
          <Icon name="code" size={14} /> Code
        </button>
      </div>

      <button className="new-session" onClick={onNew}>
        <Icon name="plus" size={15} /> {kind === "chat" ? "New chat" : "New session"}
      </button>

      <nav className="nav">
        {NAV.map((n) => (
          <div key={n.page} className={`nav-row ${page === n.page ? "selected" : ""}`} onClick={() => onPage(page === n.page ? null : n.page)}>
            <Icon name={n.icon} /> {n.label}
          </div>
        ))}
      </nav>

      <Sessions
        kind={kind}
        cwd={props.cwd}
        chatDir={props.chatDir}
        activeRootId={props.activeRootId}
        refreshKey={props.refreshKey}
        onOpen={props.onOpen}
        onWorkspace={props.onWorkspace}
      />

      <div className="side-footer tiny" title={props.footer}>
        <span className="dot status-ready" />
        <span className="ellipsis">{props.footer}</span>
      </div>
      {props.resizer}
    </aside>
  );
}
