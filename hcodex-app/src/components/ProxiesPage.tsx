import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadProxies,
  logHealth,
  maskAccounts,
  parseLog,
  proxyLog,
  proxyStatus,
  restartProxy,
  type LogLine,
  type ProxyDef,
  type ProxyStatus,
} from "../lib/proxies";
import { FuseboxAccounts } from "./FuseboxAccounts";
import { FuseboxSettings } from "./FuseboxSettings";
import { Icon } from "./Icon";

const REFRESH_MS = 8000;
const LOG_LINES = 200;

const clock = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleTimeString([], { hour12: false });
};

type Tab = "status" | "accounts" | "settings";
const TABS: Array<[Tab, string]> = [
  ["status", "Status"],
  ["accounts", "Accounts"],
  ["settings", "Settings"],
];

/**
 * Local proxies: are they up, are they serving models, what does their log say; restart from
 * here. A proxy with a management API also gets its accounts and settings.
 */
export function ProxiesPage({ home }: { home: string }) {
  const [proxies, setProxies] = useState<ProxyDef[] | null>(null);
  useEffect(() => {
    let live = true;
    loadProxies(home).then((list) => live && setProxies(list));
    return () => {
      live = false;
    };
  }, [home]);

  if (!proxies) return <div className="muted small">Loading…</div>;
  return (
    <>
      <div className="muted small page-note">
        Proxies run as launchd jobs outside this app, so they keep serving the terminal <span className="mono">hcodex</span> when the app is
        closed. Keys stay in each proxy's own config and are never shown here; account names are shortened unless you ask for them.
      </div>
      {proxies.map((p) => (
        <ProxyCard key={p.id} def={p} />
      ))}
    </>
  );
}

function ProxyCard({ def }: { def: ProxyDef }) {
  const [status, setStatus] = useState<ProxyStatus | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [error, setError] = useState("");
  const [showAccounts, setShowAccounts] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [tab, setTab] = useState<Tab>("status");
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const [s, lines] = await Promise.all([proxyStatus(def), proxyLog(def, LOG_LINES).catch(() => [] as string[])]);
      setStatus(s);
      setLog(parseLog(lines));
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, [def]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  // Follow the log's end unless the user scrolled up to read something.
  useEffect(() => {
    const box = logRef.current;
    if (box && stick.current) box.scrollTop = box.scrollHeight;
  }, [log]);

  const restart = async () => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000);
      return;
    }
    setConfirming(false);
    setRestarting(true);
    try {
      await restartProxy(def);
      // launchd brings it back at once; give it a moment to listen again.
      await new Promise((r) => setTimeout(r, 1500));
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setRestarting(false);
    }
  };

  const health = logHealth(log);
  const serving = status?.state === "running" && status.models != null;
  const tone = !status ? "off" : serving ? "ok" : "warn";
  const badge = !status
    ? "checking…"
    : status.state === "missing"
      ? "not installed"
      : status.state === "stopped"
        ? "stopped"
        : serving
          ? "running"
          : "running, not answering";
  const text = (line: LogLine) => (showAccounts ? line.text : maskAccounts(line.text));
  const names = (
    <label className="row muted small" title="The proxy's accounts, also as its log names them">
      <input type="checkbox" checked={showAccounts} onChange={(e) => setShowAccounts(e.target.checked)} /> Show account names
    </label>
  );

  return (
    <section className="proxy">
      <header className="proxy-head">
        <span className={`dot ${tone === "ok" ? "status-ready" : tone === "warn" ? "status-error" : ""}`} />
        <span className="proxy-name">{def.name}</span>
        <span className={`badge ${tone === "off" ? "" : tone}`}>{badge}</span>
        <span className="grow" />
        <button
          className={confirming ? "danger" : ""}
          onClick={restart}
          disabled={restarting || !status || status.state === "missing"}
          title="Restart the launchd job. Requests in flight are cut."
        >
          <Icon name="refresh" size={13} /> {restarting ? "Restarting…" : confirming ? "Click again to restart" : "Restart"}
        </button>
      </header>
      <div className="muted small">{def.description}</div>
      {error && <div className="error small">{error}</div>}

      {def.admin && (
        <div className="proxy-tabs">
          <div role="tablist" aria-label={`${def.name} sections`}>
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          <span className="grow" />
          {tab !== "settings" && names}
        </div>
      )}
      {tab === "accounts" && <FuseboxAccounts def={def} showNames={showAccounts} />}
      {tab === "settings" && <FuseboxSettings def={def} />}

      {tab === "status" && (
        <>
          <dl className="proxy-facts">
            <dt>Address</dt>
            <dd className="mono">{def.url}</dd>
            <dt>Provider</dt>
            <dd>
              <span className="mono">{def.provider}</span>
              {status && (status.models != null ? ` · ${status.models} models` : " · no answer to the model list")}
            </dd>
            <dt>Version</dt>
            <dd className="mono">{status?.version ?? "—"}</dd>
            <dt>Service</dt>
            <dd>
              <span className="mono">{def.label}</span>
              {status?.pid && ` · pid ${status.pid}`}
              {status?.since && ` · since ${status.since}`}
            </dd>
          </dl>

          <div className="proxy-health small">
            <span className="muted">Last {log.length} log lines:</span>
            <span className={health.errors ? "minus" : "muted"}>{health.errors} errors</span>
            <span className={health.warnings ? "warn" : "muted"}>{health.warnings} warnings</span>
            <span className={health.rateLimited ? "warn" : "muted"}>{health.rateLimited} rate-limit lines</span>
            <span className="grow" />
            {!def.admin && names}
          </div>
          {health.latest && (
            <div className="proxy-latest small ellipsis" title={text(health.latest)}>
              <span className={health.latest.level === "ERROR" ? "minus" : "warn"}>{health.latest.level}</span>{" "}
              <span className="muted">{clock(health.latest.time)}</span> {text(health.latest)}
            </div>
          )}

          <div
            className="proxy-log mono"
            ref={logRef}
            onScroll={(e) => {
              const box = e.currentTarget;
              stick.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
            }}
          >
            {log.map((line, i) => (
              <div key={i} className={`log-line ${line.level.toLowerCase()}`}>
                {line.time && <span className="log-time">{clock(line.time)}</span>}
                {line.level && <span className="log-level">{line.level}</span>}
                <span className="log-text">{text(line)}</span>
              </div>
            ))}
            {!log.length && <div className="muted pad">No log lines at {def.log}.</div>}
          </div>
        </>
      )}
    </section>
  );
}
