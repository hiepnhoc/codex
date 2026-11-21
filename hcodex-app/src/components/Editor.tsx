import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import MonacoEditor from "@monaco-editor/react";
import "../lib/monaco";
import { rpc } from "../lib/rpc";
import { readFile, writeFile, basename, languageFor } from "../lib/fs";
import type { FsChangedNotification } from "../protocol/v2/FsChangedNotification";
import { monacoTheme, useColorScheme } from "../lib/theme";
import { Icon } from "./Icon";

export type OpenFile = { path: string; content: string; saved: string };
type SetFiles = Dispatch<SetStateAction<OpenFile[]>>;

/** Open files without unsaved edits follow the disk, so what the agent writes shows up at once. */
export function useReloadOnChange(files: OpenFile[], setFiles: SetFiles) {
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => {
    return rpc.onNotification("fs/changed", async (p) => {
      const { changedPaths } = p as FsChangedNotification;
      const touched = filesRef.current.filter((f) => changedPaths.includes(f.path) && f.content === f.saved);
      if (!touched.length) return;
      const fresh = new Map<string, string>();
      await Promise.all(
        touched.map(async (f) => {
          try {
            fresh.set(f.path, await readFile(f.path));
          } catch {
            // Deleted or unreadable: keep what is shown.
          }
        }),
      );
      // Skip a file the user started editing while it was being read.
      setFiles((now) =>
        now.map((f) => (fresh.has(f.path) && f.content === f.saved ? { ...f, content: fresh.get(f.path)!, saved: fresh.get(f.path)! } : f)),
      );
    });
  }, [setFiles]);
}

type Props = {
  /** Workspace folder; the path bar shows the path relative to it. */
  root: string;
  file: OpenFile;
  setFiles: SetFiles;
};

/** One open file: its path, then the editor. ⌘S saves. */
export function Editor({ root, file, setFiles }: Props) {
  const scheme = useColorScheme();
  const fileRef = useRef(file);
  fileRef.current = file;
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);

  const save = useCallback(async () => {
    const { path, content, saved } = fileRef.current;
    if (content === saved) return;
    try {
      await writeFile(path, content);
      setFiles((now) => now.map((f) => (f.path === path ? { ...f, saved: content } : f)));
      setStatus("Saved");
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setStatus(`Save failed: ${e}`);
    }
  }, [setFiles]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const relative = file.path.startsWith(root + "/") ? file.path.slice(root.length + 1) : file.path;
  const crumbs = relative.split("/").filter(Boolean);
  const dirty = file.content !== file.saved;

  const copyPath = () => {
    navigator.clipboard?.writeText(relative).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => {},
    );
  };

  return (
    <div className="editor">
      <div className="crumbs">
        {/* Too long for the bar: the folders at the start are cut, the file name stays. */}
        <div className="crumbs-path" title={file.path}>
          <bdi>
            {crumbs.map((part, i) => (
              <span key={i} className={i === crumbs.length - 1 ? "last" : ""}>
                {i > 0 && <span className="sep">/</span>}
                {part}
              </span>
            ))}
          </bdi>
        </div>
        <span className="tiny muted">{status || (dirty ? "Unsaved · ⌘S" : "")}</span>
        <button className="icon-btn" onClick={copyPath} title="Copy the path" aria-label={`Copy the path of ${basename(file.path)}`}>
          <Icon name={copied ? "check" : "copy"} size={13} />
        </button>
      </div>
      <div className="editor-body">
        <MonacoEditor
          theme={monacoTheme(scheme)}
          path={file.path}
          language={languageFor(file.path)}
          value={file.content}
          onChange={(v) => setFiles((now) => now.map((f) => (f.path === file.path ? { ...f, content: v ?? "" } : f)))}
          options={{ fontSize: 13, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false }}
        />
      </div>
    </div>
  );
}
