import { useCallback, useEffect, useMemo, useState } from "react";
import { readDir, join, basename, type DirEntry } from "../lib/fs";
import { listFiles } from "../lib/git";
import type { FileStatus } from "../lib/diff";
import { FileIcon, Icon } from "./Icon";

/** Uncommitted changes by absolute path, plus every folder that contains one. */
export type TreeChanges = { files: Map<string, FileStatus>; dirs: Set<string> };

type Props = {
  root: string;
  selected: string | null;
  onOpen: (path: string) => void;
  /** Bumped when something under the root changes on disk: open folders read themselves again. */
  version: number;
  changes: TreeChanges;
};

const STATUS_LETTER: Record<FileStatus, string> = { added: "A", modified: "M", deleted: "D" };
const RESULT_LIMIT = 80;

/** Files whose path contains every word typed; a match in the file name ranks above one in a folder name. */
function search(paths: string[], query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored: Array<[number, string]> = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    if (!words.every((w) => lower.includes(w))) continue;
    const name = lower.slice(lower.lastIndexOf("/") + 1);
    const rank = name.startsWith(words[0]) ? 0 : words.every((w) => name.includes(w)) ? 1 : 2;
    scored.push([rank, path]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]));
  return scored.slice(0, RESULT_LIMIT).map(([, path]) => path);
}

/** The workspace's files: a tree, and a search box that finds a file by any part of its path. */
export function FileTree({ root, selected, onOpen, version, changes }: Props) {
  const [query, setQuery] = useState("");
  const [paths, setPaths] = useState<string[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const searching = query.trim().length > 0;

  // The list is only read once somebody searches, and again when files come or go.
  useEffect(() => {
    if (!searching || !root) return;
    let live = true;
    listFiles(root).then(
      (list) => live && (setPaths(list), setFailed(null)),
      (e) => live && setFailed(String(e)),
    );
    return () => {
      live = false;
    };
  }, [root, searching, version]);
  useEffect(() => setPaths(null), [root]);

  const results = useMemo(() => (searching && paths ? search(paths, query) : []), [paths, query, searching]);
  const open = (relative: string) => onOpen(join(root, relative));

  if (!root) return <div className="empty small">No workspace folder.</div>;
  return (
    <div className="explorer">
      <label className="explorer-search">
        <Icon name="search" size={14} />
        <input
          value={query}
          placeholder="Search files"
          aria-label="Search files"
          spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setQuery("");
            else if (e.key === "ArrowDown") (e.preventDefault(), setCursor((c) => Math.min(c + 1, results.length - 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setCursor((c) => Math.max(c - 1, 0)));
            else if (e.key === "Enter" && results[cursor]) open(results[cursor]);
          }}
        />
        {searching && (
          <button className="icon-btn" onClick={() => setQuery("")} title="Clear" aria-label="Clear the search">
            <Icon name="x" size={12} />
          </button>
        )}
      </label>
      {searching ? (
        <div className="tree">
          {results.map((path, i) => {
            const status = changes.files.get(join(root, path));
            return (
              <div
                key={path}
                className={`tree-row file ${i === cursor ? "selected" : ""}`}
                onClick={() => open(path)}
                onMouseEnter={() => setCursor(i)}
                title={path}
              >
                <FileIcon name={path} />
                <span className="ellipsis">{basename(path)}</span>
                <span className="tree-dir ellipsis">{path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""}</span>
                {status && <span className={`tree-badge ${status}`}>{STATUS_LETTER[status]}</span>}
              </div>
            );
          })}
          {!results.length && <div className="muted small pad">{failed ?? (paths ? "No file matches." : "Reading the file list…")}</div>}
        </div>
      ) : (
        <div className="tree">
          <Dir path={root} name={basename(root) || root} depth={0} open selected={selected} onOpen={onOpen} version={version} changes={changes} />
        </div>
      )}
    </div>
  );
}

type DirProps = {
  path: string;
  name: string;
  depth: number;
  open?: boolean;
  selected: string | null;
  onOpen: (p: string) => void;
  version: number;
  changes: TreeChanges;
};

function Dir({ path, name, depth, open: initialOpen, selected, onOpen, version, changes }: DirProps) {
  const [open, setOpen] = useState(!!initialOpen);
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    readDir(path)
      .then((e) => {
        setEntries(e);
        setErr(null);
      })
      .catch((e) => setErr(String(e)));
  }, [path]);

  useEffect(() => {
    if (open) load();
  }, [open, load, version]);

  return (
    <div>
      <div className="tree-row" style={{ paddingLeft: 6 + depth * 14 }} onClick={() => setOpen((o) => !o)}>
        <span className={`caret ${open ? "open" : ""}`}>
          <Icon name="chevronRight" size={11} />
        </span>
        <span className="folder">
          <Icon name={open ? "folderOpen" : "folder"} size={15} />
        </span>
        <span className="ellipsis">{name}</span>
        {changes.dirs.has(path) && <span className="tree-badge dot" title="Contains uncommitted changes" />}
      </div>
      {open &&
        (err ? (
          <div className="muted tiny" style={{ paddingLeft: 28 + depth * 14 }}>
            {err}
          </div>
        ) : (
          entries?.map((e) => {
            const child = join(path, e.fileName);
            if (e.isDirectory) {
              return <Dir key={e.fileName} path={child} name={e.fileName} depth={depth + 1} selected={selected} onOpen={onOpen} version={version} changes={changes} />;
            }
            const status = changes.files.get(child);
            return (
              <div
                key={e.fileName}
                className={`tree-row file ${selected === child ? "selected" : ""} ${status ?? ""}`}
                style={{ paddingLeft: 6 + (depth + 1) * 14 }}
                onClick={() => onOpen(child)}
              >
                <span className="caret-gap" />
                <FileIcon name={e.fileName} />
                <span className="ellipsis">{e.fileName}</span>
                {status && <span className={`tree-badge ${status}`}>{STATUS_LETTER[status]}</span>}
              </div>
            );
          })
        ))}
    </div>
  );
}
