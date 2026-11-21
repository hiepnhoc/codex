import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "./lib/rpc";
import { transport } from "./lib/transport";
import { join, readFile } from "./lib/fs";
import { loadCatalog, type Catalog } from "./lib/models";
import { resumeThread, useAgentRows, useDiff, useThread, wireStore, type ModelChoice, type SessionKind } from "./lib/store";
import type { Thread } from "./protocol/v2/Thread";
import type { Tab } from "./components/Editor";
import { ChatPane } from "./components/ChatPane";
import { Logo } from "./components/Icon";
import { Pages } from "./components/Pages";
import { Resizer, clamp, useStoredWidth } from "./components/Resizer";
import { RightPane, type RightTab } from "./components/RightPane";
import { Sidebar, type Page } from "./components/Sidebar";
import "./app.css";

type Boot = "booting" | "ready" | "error";

const EMPTY_CATALOG: Catalog = { defaultChoice: { provider: "", model: "" }, providers: [] };
const NO_ROOTS: Record<SessionKind, string | null> = { chat: null, code: null };

const SIDE_DEFAULT = 252;
const SIDE_MIN = 200;
const SIDE_MAX = 440;
/** The conversation and the workspace pane never get narrower than this. */
const PANE_MIN = 320;
const rightDefault = () => Math.round(window.innerWidth * 0.42);

export default function App() {
  const [boot, setBoot] = useState<Boot>("booting");
  const [bootMsg, setBootMsg] = useState("starting app-server…");
  const [kind, setKind] = useState<SessionKind>("code");
  /** Workspace of Code sessions. */
  const [cwd, setCwd] = useState("");
  /** Folder every Chat session runs in (`<hcodex home>/chat`). */
  const [chatDir, setChatDir] = useState("");
  /** hcodex home (`~/.hcodex`), where per-user app files live. */
  const [home, setHome] = useState("");
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [choice, setChoice] = useState<ModelChoice>(EMPTY_CATALOG.defaultChoice);
  /** The open session of each mode, so switching Chat/Code keeps both. */
  const [roots, setRoots] = useState(NO_ROOTS);
  const [viewId, setViewId] = useState<string | null>(null);
  const [page, setPage] = useState<Page | null>(null);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightTab, setRightTab] = useState<RightTab>("files");
  const [files, setFiles] = useState<Tab[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [sessionsKey, setSessionsKey] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [sideWidth, setSideWidth] = useStoredWidth("hcodex.sideWidth", SIDE_DEFAULT);
  const [rightWidth, setRightWidth] = useStoredWidth("hcodex.rightWidth", rightDefault());

  const rootId = roots[kind];
  const root = useThread(rootId);
  const turnDiff = useDiff(roots.code);
  /** A chat session has no workspace; its side pane only exists to list sub-agents. */
  const hasAgents = useAgentRows(rootId).length > 1;
  const sessionCwd = kind === "chat" ? chatDir : cwd;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await rpc.start();
        setBootMsg(`pid ${info.pid} · ${info.codex_bin}`);
        const init = await rpc.initialize({ name: "hcodex-app", title: "hcodex", version: "0.1.0" });
        wireStore();
        const wd = await transport.defaultCwd();
        const chat = join(String(init.codexHome), "chat");
        await rpc.request("fs/createDirectory", { path: chat, recursive: true }).catch((e) => console.warn("chat folder:", e));
        const cat = await loadCatalog(wd);
        if (cancelled) return;
        setCwd(wd);
        setChatDir(chat);
        setHome(String(init.codexHome));
        setCatalog(cat);
        setChoice(cat.defaultChoice);
        setBoot("ready");
      } catch (e) {
        console.error("boot failed:", e);
        setBoot("error");
        setBootMsg(String(e));
      }
    })();
    const offLog = rpc.onLog((l) => setLogs((p) => [...p.slice(-200), l]));
    const offExit = rpc.onExit(() => {
      setBoot("error");
      setBootMsg("app-server exited");
    });
    return () => {
      cancelled = true;
      offLog();
      offExit();
    };
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      if (!files.some((t) => t.path === path)) {
        try {
          const content = await readFile(path);
          setFiles((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, content, saved: content }]));
        } catch (e) {
          console.warn("open failed:", e);
          return;
        }
      }
      setActiveFile(path);
      setRightTab("files");
      setRightOpen(true);
    },
    [files],
  );

  // Bring the diff forward as soon as a turn produces one.
  const hadDiff = useRef(false);
  useEffect(() => {
    if (turnDiff && !hadDiff.current) setRightTab("changes");
    hadDiff.current = !!turnDiff;
  }, [turnDiff]);

  // The session list changes when the main thread finishes a turn (new title, new order).
  const rootState = root?.state;
  const wasRunning = useRef(false);
  useEffect(() => {
    const running = rootState === "running" || rootState === "waiting";
    if (wasRunning.current && !running) setSessionsKey((k) => k + 1);
    wasRunning.current = running;
  }, [rootState]);

  const setRoot = useCallback((k: SessionKind, id: string | null) => {
    setRoots((r) => ({ ...r, [k]: id }));
    setViewId(null);
    if (id) setSessionsKey((n) => n + 1);
  }, []);

  const switchKind = useCallback((k: SessionKind) => {
    setKind(k);
    setViewId(null);
    setPage(null);
  }, []);

  /** Make `dir` the workspace; a different folder starts with no open session or files. */
  const switchWorkspace = useCallback(
    (dir: string) => {
      setPage(null);
      if (!dir || dir === cwd) return;
      setCwd(dir);
      setFiles([]);
      setActiveFile(null);
      setRoot("code", null);
    },
    [cwd, setRoot],
  );

  const openSession = useCallback(
    async (t: Thread) => {
      const k: SessionKind = t.cwd === chatDir ? "chat" : "code";
      try {
        if (k === "code" && t.cwd !== cwd) {
          setCwd(t.cwd);
          setFiles([]);
          setActiveFile(null);
        }
        const id = await resumeThread(t.id, k);
        setKind(k);
        setPage(null);
        setRoot(k, id);
        // Keep the thread on the provider and model it was recorded with.
        if (t.modelProvider) setChoice({ provider: t.modelProvider, model: t.model ?? "" });
      } catch (e) {
        setBootMsg(`open session failed: ${e}`);
      }
    },
    [chatDir, cwd, setRoot],
  );

  const newSession = useCallback(() => {
    setPage(null);
    setRoot(kind, null);
    setChoice((c) => (c.model ? c : catalog.defaultChoice));
  }, [kind, catalog, setRoot]);

  if (boot !== "ready") {
    return (
      <div className={`boot status-${boot}`}>
        <div className="brand">
          <Logo size={24} /> hcodex
        </div>
        <div className="mono small muted">{bootMsg}</div>
        {boot === "error" && <pre className="mono tiny logs-pre">{logs.slice(-30).join("\n")}</pre>}
      </div>
    );
  }

  const showRight = rightOpen && (kind === "code" || hasAgents);

  return (
    <div
      className="layout"
      style={{
        gridTemplateColumns: showRight
          ? `${sideWidth}px minmax(${PANE_MIN}px, 1fr) minmax(${PANE_MIN}px, ${rightWidth}px)`
          : `${sideWidth}px minmax(0, 1fr)`,
      }}
    >
      <Sidebar
        kind={kind}
        onKind={switchKind}
        cwd={cwd}
        chatDir={chatDir}
        activeRootId={rootId}
        refreshKey={sessionsKey}
        page={page}
        onPage={setPage}
        onOpen={openSession}
        onNew={newSession}
        onWorkspace={switchWorkspace}
        footer={bootMsg}
        resizer={<Resizer edge="right" onDrag={(x) => setSideWidth(clamp(x, SIDE_MIN, SIDE_MAX))} onReset={() => setSideWidth(SIDE_DEFAULT)} />}
      />

      <main className="center">
        {page && <Pages page={page} cwd={sessionCwd} home={home} catalog={catalog} onClose={() => setPage(null)} />}
        <div className={page ? "hidden" : "center-chat"}>
          <ChatPane
            kind={kind}
            cwd={sessionCwd}
            catalog={catalog}
            choice={choice}
            onChoice={setChoice}
            rootId={rootId}
            viewId={viewId}
            onRootChange={(id) => setRoot(kind, id)}
            onViewChange={setViewId}
            onOpenFile={openFile}
            rightOpen={rightOpen}
            onToggleRight={() => setRightOpen((o) => !o)}
            onShowAgents={() => setRightOpen(true)}
          />
        </div>
      </main>

      {/* Always mounted, so the terminal and open files survive hiding the pane or switching mode. */}
      <div className={showRight ? "right-host" : "hidden"}>
        <Resizer
          edge="left"
          onDrag={(x) => setRightWidth(clamp(window.innerWidth - x, PANE_MIN, window.innerWidth - sideWidth - PANE_MIN))}
          onReset={() => setRightWidth(rightDefault())}
        />
        <RightPane
          kind={kind}
          cwd={cwd}
          tab={rightTab}
          onTab={setRightTab}
          turnDiff={turnDiff}
          refreshKey={sessionsKey}
          files={files}
          activeFile={activeFile}
          onFilesChange={setFiles}
          onActivateFile={setActiveFile}
          onOpenFile={openFile}
          rootId={rootId}
          viewId={viewId}
          onSelectAgent={(id) => setViewId(id === rootId ? null : id)}
        />
      </div>
    </div>
  );
}
