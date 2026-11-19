import { useCallback, useEffect, useRef, useState } from "react";
import { rpc } from "./lib/rpc";
import { transport } from "./lib/transport";
import { readFile } from "./lib/fs";
import { loadCatalog, type Catalog } from "./lib/models";
import { resumeThread, useDiff, useThread, wireStore, type ModelChoice } from "./lib/store";
import type { Thread } from "./protocol/v2/Thread";
import { FileTree } from "./components/FileTree";
import { Editor, CHANGES_TAB, type Tab } from "./components/Editor";
import { Terminal } from "./components/Terminal";
import { AgentPanel } from "./components/AgentPanel";
import { ModelPicker } from "./components/ModelPicker";
import { Sessions } from "./components/Sessions";
import "./app.css";

type Boot = "booting" | "ready" | "error";
type SideTab = "sessions" | "files";

const EMPTY_CATALOG: Catalog = { defaultChoice: { provider: "", model: "" }, providers: [] };

export default function App() {
  const [boot, setBoot] = useState<Boot>("booting");
  const [bootMsg, setBootMsg] = useState("starting app-server…");
  const [cwd, setCwd] = useState("");
  const [cwdInput, setCwdInput] = useState("");
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  const [choice, setChoice] = useState<ModelChoice>(EMPTY_CATALOG.defaultChoice);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(true);
  const [sideTab, setSideTab] = useState<SideTab>("sessions");
  const [rootId, setRootId] = useState<string | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [sessionsKey, setSessionsKey] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);

  const root = useThread(rootId);
  const turnDiff = useDiff(rootId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await rpc.start();
        setBootMsg(`pid ${info.pid} · ${info.codex_bin} · CODEX_HOME=${info.codex_home ?? "default"}`);
        await rpc.initialize({ name: "hcodex-app", title: "hcodex", version: "0.1.0" });
        wireStore();
        const wd = await transport.defaultCwd();
        const cat = await loadCatalog(wd);
        if (cancelled) return;
        setCwd(wd);
        setCwdInput(wd);
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
      if (!tabs.some((t) => t.path === path)) {
        try {
          const content = await readFile(path);
          setTabs((prev) => (prev.some((t) => t.path === path) ? prev : [...prev, { path, content, saved: content }]));
        } catch (e) {
          setBootMsg(`open failed: ${e}`);
          return;
        }
      }
      setActive(path);
    },
    [tabs],
  );

  // Show the agent's diff as soon as a turn produces one.
  useEffect(() => {
    if (turnDiff) setActive((a) => a ?? CHANGES_TAB);
  }, [turnDiff]);

  // The session list changes when the main thread finishes a turn (new title, new order).
  const rootState = root?.state;
  const wasRunning = useRef(false);
  useEffect(() => {
    const running = rootState === "running" || rootState === "waiting";
    if (wasRunning.current && !running) setSessionsKey((k) => k + 1);
    wasRunning.current = running;
  }, [rootState]);

  const switchWorkspace = useCallback(
    (dir: string) => {
      if (!dir || dir === cwd) return;
      setCwd(dir);
      setCwdInput(dir);
      setTabs([]);
      setActive(null);
    },
    [cwd],
  );

  const changeRoot = useCallback((id: string | null) => {
    setRootId(id);
    setViewId(null);
    if (id) setSessionsKey((k) => k + 1);
  }, []);

  const openSession = useCallback(
    async (t: Thread) => {
      try {
        switchWorkspace(t.cwd);
        const id = await resumeThread(t.id);
        setRootId(id);
        setViewId(null);
        // Keep the thread on the provider and model it was recorded with.
        if (t.modelProvider) setChoice({ provider: t.modelProvider, model: t.model ?? "" });
      } catch (e) {
        setBootMsg(`open session failed: ${e}`);
      }
    },
    [switchWorkspace],
  );

  const newSession = useCallback(() => {
    setRootId(null);
    setViewId(null);
    setChoice((c) => (c.model ? c : catalog.defaultChoice));
  }, [catalog]);

  if (boot !== "ready") {
    return (
      <div className={`boot status-${boot}`}>
        <div className="sidebar-title">hcodex</div>
        <div className="mono small">{bootMsg}</div>
        {boot === "error" && <pre className="mono tiny logs-pre">{logs.slice(-30).join("\n")}</pre>}
      </div>
    );
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="side-tabs">
          <span className={`side-tab ${sideTab === "sessions" ? "active" : ""}`} onClick={() => setSideTab("sessions")}>
            Sessions
          </span>
          <span className={`side-tab ${sideTab === "files" ? "active" : ""}`} onClick={() => setSideTab("files")}>
            Files
          </span>
        </div>
        <div className="row">
          <input
            className="mono small grow"
            value={cwdInput}
            onChange={(e) => setCwdInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && switchWorkspace(cwdInput)}
            title="workspace root (Enter to apply)"
          />
        </div>
        {sideTab === "sessions" ? (
          <Sessions cwd={cwd} activeRootId={rootId} refreshKey={sessionsKey} onOpen={openSession} onNew={newSession} />
        ) : (
          <div className="tree-scroll">
            <FileTree root={cwd} selected={active} onOpen={openFile} />
          </div>
        )}
        <details className="logs">
          <summary className="muted tiny">server logs ({logs.length})</summary>
          <pre className="mono tiny logs-pre">{logs.slice(-40).join("\n")}</pre>
        </details>
      </aside>

      <main className="center">
        <Editor tabs={tabs} active={active} onTabsChange={setTabs} onActivate={setActive} turnDiff={turnDiff} />
        <div className="panel-bar">
          <span className="small" onClick={() => setShowTerminal((s) => !s)} style={{ cursor: "pointer" }}>
            {showTerminal ? "▾" : "▸"} Terminal
          </span>
          <span className="muted tiny" style={{ marginLeft: "auto" }}>
            {bootMsg}
          </span>
        </div>
        {showTerminal && <Terminal cwd={cwd} />}
      </main>

      <aside className="right">
        <div className="row model-row">
          <ModelPicker catalog={catalog} value={choice} onChange={setChoice} />
          {root && choice.provider && root.provider && choice.provider !== root.provider && (
            <span className="tiny warn" title="the next message continues this conversation on the new provider">
              switches provider
            </span>
          )}
        </div>
        <AgentPanel
          cwd={cwd}
          choice={choice}
          rootId={rootId}
          viewId={viewId}
          onRootChange={changeRoot}
          onViewChange={setViewId}
          onOpenFile={openFile}
        />
      </aside>
    </div>
  );
}
