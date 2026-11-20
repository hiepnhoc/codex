import { useCallback, useEffect, useRef, useState } from "react";
import MonacoEditor from "@monaco-editor/react";
import "../lib/monaco";
import { rpc } from "../lib/rpc";
import { readFile, writeFile, basename, languageFor } from "../lib/fs";
import type { FsChangedNotification } from "../protocol/v2/FsChangedNotification";

export type Tab = { path: string; content: string; saved: string };

type Props = {
  tabs: Tab[];
  active: string | null;
  onTabsChange: (tabs: Tab[]) => void;
  onActivate: (path: string | null) => void;
};

/** Tabbed file editor; a tab reloads itself when the file changes on disk and it has no unsaved edits. */
export function Editor({ tabs, active, onTabsChange, onActivate }: Props) {
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [status, setStatus] = useState("");

  // Reload clean tabs when the agent (or anything else) changes the file on disk.
  useEffect(() => {
    return rpc.onNotification("fs/changed", async (p) => {
      const { changedPaths } = p as FsChangedNotification;
      const current = tabsRef.current;
      const touched = current.filter((t) => changedPaths.includes(t.path) && t.content === t.saved);
      if (!touched.length) return;
      const reloaded = await Promise.all(
        touched.map(async (t) => {
          try {
            const c = await readFile(t.path);
            return { ...t, content: c, saved: c };
          } catch {
            return t;
          }
        }),
      );
      onTabsChange(tabsRef.current.map((t) => reloaded.find((r) => r.path === t.path) ?? t));
    });
  }, [onTabsChange]);

  const save = useCallback(async () => {
    const t = tabsRef.current.find((x) => x.path === active);
    if (!t || t.content === t.saved) return;
    try {
      await writeFile(t.path, t.content);
      onTabsChange(tabsRef.current.map((x) => (x.path === t.path ? { ...x, saved: x.content } : x)));
      setStatus(`saved ${basename(t.path)}`);
      setTimeout(() => setStatus(""), 1500);
    } catch (e) {
      setStatus(`save failed: ${e}`);
    }
  }, [active, onTabsChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  const close = (path: string) => {
    const next = tabs.filter((t) => t.path !== path);
    onTabsChange(next);
    if (active === path) onActivate(next.length ? next[next.length - 1].path : null);
  };

  const tab = tabs.find((t) => t.path === active);

  return (
    <div className="editor">
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t.path} className={`tab ${t.path === active ? "active" : ""}`} onClick={() => onActivate(t.path)} title={t.path}>
            {basename(t.path)}
            {t.content !== t.saved ? " ●" : ""}
            <span
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                close(t.path);
              }}
            >
              ×
            </span>
          </div>
        ))}
        <span className="muted tiny" style={{ marginLeft: "auto", padding: "0 8px" }}>
          {status}
        </span>
      </div>
      <div className="editor-body">
        {tab ? (
          <MonacoEditor
            theme="vs-dark"
            path={tab.path}
            language={languageFor(tab.path)}
            value={tab.content}
            onChange={(v) => onTabsChange(tabsRef.current.map((t) => (t.path === tab.path ? { ...t, content: v ?? "" } : t)))}
            options={{ fontSize: 13, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false }}
          />
        ) : (
          <div className="muted empty small">Open a file from the tree.</div>
        )}
      </div>
    </div>
  );
}
