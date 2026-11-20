import { memo, useMemo, useState } from "react";
import { basename } from "../lib/fs";
import { FileIcon, Icon } from "./Icon";

type Line = { kind: "add" | "del" | "ctx" | "hunk"; text: string; oldNo: number | null; newNo: number | null };
type FileDiff = { path: string; status: "added" | "deleted" | "modified"; added: number; removed: number; lines: Line[] };

/** Lines of one file shown before "Show all": a huge generated file must not freeze the pane. */
const PREVIEW_LINES = 400;

function parse(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let file: FileDiff | null = null;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("diff --git ")) {
      const match = / b\/(.+)$/.exec(raw);
      file = { path: match ? match[1] : raw.slice(11), status: "modified", added: 0, removed: 0, lines: [] };
      files.push(file);
      inHunk = false;
      continue;
    }
    if (!file) continue;
    if (!inHunk) {
      if (raw.startsWith("new file mode")) file.status = "added";
      else if (raw.startsWith("deleted file mode")) file.status = "deleted";
      else if (raw.startsWith("+++ b/")) file.path = raw.slice(6);
    }
    if (raw.startsWith("@@")) {
      const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(raw);
      oldNo = match ? Number(match[1]) : 0;
      newNo = match ? Number(match[2]) : 0;
      inHunk = true;
      file.lines.push({ kind: "hunk", text: match?.[3].trim() ?? "", oldNo: null, newNo: null });
      continue;
    }
    if (!inHunk) continue;
    if (raw.startsWith("+")) {
      file.added++;
      file.lines.push({ kind: "add", text: raw.slice(1), oldNo: null, newNo: newNo++ });
    } else if (raw.startsWith("-")) {
      file.removed++;
      file.lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++, newNo: null });
    } else if (raw.startsWith(" ")) {
      file.lines.push({ kind: "ctx", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return files;
}

const STATUS_WORD = { added: "new", deleted: "deleted", modified: "" } as const;

function FileSection({ file, onOpen }: { file: FileDiff; onOpen?: (path: string) => void }) {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const lines = all ? file.lines : file.lines.slice(0, PREVIEW_LINES);
  const dir = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/") + 1) : "";
  return (
    <section className="diff-file">
      <header className="diff-head" onClick={() => setOpen((o) => !o)}>
        <span className={`caret ${open ? "open" : ""}`}>
          <Icon name="chevronRight" size={11} />
        </span>
        <FileIcon name={file.path} />
        <span className="diff-path ellipsis" title={file.path}>
          <span className="muted">{dir}</span>
          {basename(file.path)}
        </span>
        {STATUS_WORD[file.status] && <span className="badge">{STATUS_WORD[file.status]}</span>}
        <span className="grow" />
        {file.added > 0 && <span className="plus">+{file.added}</span>}
        {file.removed > 0 && <span className="minus">-{file.removed}</span>}
        {onOpen && file.status !== "deleted" && (
          <button
            className="icon-btn"
            title="Open the file"
            aria-label={`Open ${file.path}`}
            onClick={(e) => {
              e.stopPropagation();
              onOpen(file.path);
            }}
          >
            <Icon name="edit" size={13} />
          </button>
        )}
      </header>
      {open && (
        <div className="diff-body mono">
          {lines.map((line, i) =>
            line.kind === "hunk" ? (
              <div key={i} className="diff-line hunk">
                <span className="no" />
                <span className="no" />
                <span className="text">{line.text || "⋯"}</span>
              </div>
            ) : (
              <div key={i} className={`diff-line ${line.kind}`}>
                <span className="no">{line.oldNo ?? ""}</span>
                <span className="no">{line.newNo ?? ""}</span>
                <span className="text">{line.text || " "}</span>
              </div>
            ),
          )}
          {!all && file.lines.length > PREVIEW_LINES && (
            <button className="link small pad" onClick={() => setAll(true)}>
              Show all {file.lines.length} lines
            </button>
          )}
          {file.lines.length === 0 && <div className="muted small pad">No text changes (binary file or mode change).</div>}
        </div>
      )}
    </section>
  );
}

/** A unified diff as one collapsible section per file. `onOpen` gets the path relative to the diff's root. */
export const DiffView = memo(function DiffView({ diff, onOpen }: { diff: string; onOpen?: (path: string) => void }) {
  const files = useMemo(() => parse(diff), [diff]);
  if (!files.length) return <pre className="diff-raw mono">{diff}</pre>;
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);
  return (
    <div className="diff">
      <div className="diff-summary">
        {files.length} file{files.length === 1 ? "" : "s"} changed
        <span className="plus">+{added}</span>
        <span className="minus">-{removed}</span>
      </div>
      {files.map((f) => (
        <FileSection key={f.path} file={f} onOpen={onOpen} />
      ))}
    </div>
  );
});
