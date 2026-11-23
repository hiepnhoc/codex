import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FuseboxError,
  accountState,
  clearAccountError,
  listAccounts,
  refreshAccount,
  refreshAccountUsage,
  removeAccount,
  setAccountDisabled,
  setAccountPriority,
  testAccount,
  type Account,
  type AccountState,
  type UsageLimit,
} from "../lib/fusebox";
import { openExternal } from "../lib/open";
import { maskAccounts, type ProxyDef } from "../lib/proxies";
import { Icon } from "./Icon";

const REFRESH_MS = 15000;

/** "3d 4h", "2h 05m", "12m", "40s". */
function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s >= 86400) return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}m`;
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return `${s}s`;
}

const until = (iso: string | null | undefined, now: number) => (iso && Date.parse(iso) > now ? span(Date.parse(iso) - now) : null);
const percent = (n: number) => `${n >= 10 || n === 0 ? Math.round(n) : n.toFixed(1)}%`;
const amount = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const PROVIDERS: Record<string, string> = { codex: "ChatGPT (Codex)", claude: "Claude", antigravity: "Antigravity", kiro: "Kiro", xai: "Grok", kimi: "Kimi", meta: "Meta", devin: "Devin", vertex: "Vertex AI", gemini: "Gemini", openai: "OpenAI" };
const providerName = (id: string) => PROVIDERS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);

type Gauge = { key: string; name: string; share: number | null; text: string; resets: string | null };

/** Everything the account reports about its usage, as bars where a share is known. */
function gauges(a: Account, now: number): Gauge[] {
  const fromLimit = (l: UsageLimit): Gauge | null => {
    const resets = until(l.resets_at, now);
    if (l.unlimited) return { key: l.id, name: l.name, share: null, text: "unlimited", resets };
    if (l.used_percent != null) return { key: l.id, name: l.name, share: l.used_percent, text: percent(l.used_percent), resets };
    if (l.used != null && l.limit) {
      return { key: l.id, name: l.name, share: (l.used / l.limit) * 100, text: `${amount(l.used)} of ${amount(l.limit)}${l.unit ? ` ${l.unit}` : ""}`, resets };
    }
    if (l.remaining != null) return { key: l.id, name: l.name, share: null, text: `${amount(l.remaining)}${l.unit ? ` ${l.unit}` : ""} left`, resets };
    return null;
  };
  const windows = a.windows.map((w): Gauge => ({ key: `w:${w.name}`, name: w.name, share: w.used, text: percent(w.used), resets: until(w.resets_at, now) }));
  return [...windows, ...a.limits.map(fromLimit).filter((g): g is Gauge => !!g)];
}

function Bar({ share }: { share: number }) {
  const tone = share >= 90 ? "err" : share >= 70 ? "warn" : "ok";
  return (
    <span className="gauge-bar" role="img" aria-label={`${Math.round(share)} percent used`}>
      <span className={tone} style={{ width: `${Math.min(100, Math.max(share > 0 ? 3 : 0, share))}%` }} />
    </span>
  );
}

const stateLine = (st: AccountState, now: number) => {
  const left = until(st.until, now);
  return [st.word, st.model, left && `${left} left`].filter(Boolean).join(" · ");
};

/** The accounts a Fusebox proxy routes over: their state and usage, and the switches for each. */
export function FuseboxAccounts({ def, showNames }: { def: ProxyDef; showNames: boolean }) {
  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [error, setError] = useState<FuseboxError | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** What is running on an account right now, by account id. */
  const [busy, setBusy] = useState<Record<string, string>>({});
  /** The outcome of the last action on an account. */
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [removing, setRemoving] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const live = useRef(true);

  const reload = useCallback(async () => {
    try {
      const list = await listAccounts(def);
      if (!live.current) return;
      setAccounts(list);
      setError(null);
    } catch (e) {
      if (live.current) setError(e instanceof FuseboxError ? e : new FuseboxError(String(e), 0));
    }
    if (live.current) setNow(Date.now());
  }, [def]);

  useEffect(() => {
    live.current = true;
    reload();
    const timer = setInterval(reload, REFRESH_MS);
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, [reload]);

  const act = async (id: string, doing: string, run: () => Promise<string | void>) => {
    setBusy((b) => ({ ...b, [id]: doing }));
    try {
      const said = await run();
      setNotes((n) => ({ ...n, [id]: { ok: true, text: said || "Done." } }));
    } catch (e) {
      setNotes((n) => ({ ...n, [id]: { ok: false, text: e instanceof Error ? e.message : String(e) } }));
    }
    await reload();
    setBusy((b) => {
      const { [id]: _done, ...rest } = b;
      return rest;
    });
  };

  const remove = (a: Account) => {
    if (removing !== a.id) {
      setRemoving(a.id);
      setTimeout(() => setRemoving((id) => (id === a.id ? null : id)), 4000);
      return;
    }
    setRemoving(null);
    setOpen(null);
    act(a.id, "Removing…", () => removeAccount(def, a.id).then(() => "Removed."));
  };

  const groups = useMemo(() => {
    const by = new Map<string, Account[]>();
    for (const a of accounts ?? []) by.set(a.provider, [...(by.get(a.provider) ?? []), a]);
    return [...by.entries()].sort((x, y) => x[0].localeCompare(y[0]));
  }, [accounts]);

  const tally = useMemo(() => {
    const t = { ok: 0, warn: 0, err: 0, off: 0 };
    for (const a of accounts ?? []) t[accountState(a, now).tone]++;
    return t;
  }, [accounts, now]);

  if (error && (error.status === 401 || error.status === 403)) {
    return (
      <div className="proxy-locked small">
        <span>
          {error.status === 401
            ? `${def.name} asks for its management key. This app does not read or keep keys, so its accounts are managed in its own dashboard.`
            : error.message}
        </span>
        <button onClick={() => openExternal(def.url)}>
          <Icon name="external" size={13} /> Open the dashboard
        </button>
      </div>
    );
  }
  if (!accounts) return <div className={error ? "error small" : "muted small"}>{error ? error.message : "Loading accounts…"}</div>;

  const name = (a: Account) => (showNames ? a.label : maskAccounts(a.label));

  return (
    <div className="accounts">
      <div className="accounts-head small">
        <span>
          {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
        </span>
        <span className="plus">{tally.ok} ready</span>
        {tally.warn > 0 && <span className="warn">{tally.warn} cooling</span>}
        {tally.err > 0 && <span className="minus">{tally.err} failing</span>}
        {tally.off > 0 && <span className="muted">{tally.off} disabled</span>}
        <span className="grow" />
        <button className="ghost" onClick={() => openExternal(def.url)} title={`Signing in to a provider happens in ${def.name}'s own dashboard`}>
          <Icon name="external" size={13} /> Connect an account
        </button>
      </div>
      {error && <div className="error small">{error.message}</div>}
      {!accounts.length && <div className="muted small pad">No accounts yet. Connect one in {def.name}'s dashboard.</div>}

      {groups.map(([provider, list]) => (
        <div key={provider} className="account-group">
          <div className="account-group-title tiny muted">
            {providerName(provider)} · {list.length}
          </div>
          {list.map((a) => {
            const st = accountState(a, now);
            const all = gauges(a, now);
            // In the row: the time windows when the provider reports them, else its other limits.
            const bars = all.filter((g) => g.share != null);
            const shown = (a.windows.length ? bars.filter((g) => g.key.startsWith("w:")) : bars).slice(0, 2);
            const isOpen = open === a.id;
            const note = notes[a.id];
            const working = busy[a.id];
            const token = a.kind === "oauth" && a.expires_at ? (until(a.expires_at, now) ? `sign-in valid ${until(a.expires_at, now)}` : "sign-in expired") : null;
            return (
              <div key={a.id} className={`account ${isOpen ? "open" : ""} ${a.disabled ? "off" : ""}`}>
                <button className="account-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : a.id)}>
                  <span className={`dot ${st.tone === "ok" ? "status-ready" : st.tone === "err" ? "status-error" : st.tone === "warn" ? "status-warn" : ""}`} />
                  <span className="account-name">
                    <span className="ellipsis">{name(a)}</span>
                    <span className="tiny muted ellipsis">{[a.plan, a.kind === "oauth" ? "sign-in" : "API key", `${a.models} models`].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className={`badge ${st.tone === "off" ? "" : st.tone}`}>{working ?? stateLine(st, now)}</span>
                  <Icon name={isOpen ? "chevronDown" : "chevronRight"} size={13} />
                  {shown.length > 0 && (
                    <span className="account-gauges">
                      {shown.map((g) => (
                        <span key={g.key} className="gauge" title={`${g.name}: ${g.text}${g.resets ? `, resets in ${g.resets}` : ""}`}>
                          <span className="tiny muted ellipsis">{g.name}</span>
                          <Bar share={g.share!} />
                          <span className="tiny mono">{percent(g.share!)}</span>
                        </span>
                      ))}
                    </span>
                  )}
                </button>

                {isOpen && (
                  <div className="account-detail small">
                    {a.last_error && <div className="account-error">{showNames ? a.last_error : maskAccounts(a.last_error)}</div>}
                    {note && <div className={note.ok ? "account-note" : "account-note bad"}>{showNames ? note.text : maskAccounts(note.text)}</div>}

                    {all.length > 0 && (
                      <div className="account-usage">
                        {all.map((g) => (
                          <div key={g.key} className="usage-line">
                            <span className="usage-name">
                              <span className="ellipsis">{g.name}</span>
                              {g.resets && <span className="tiny muted">resets in {g.resets}</span>}
                            </span>
                            {g.share != null ? <Bar share={g.share} /> : <span />}
                            <span className="mono">{g.text}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    <dl className="proxy-facts">
                      <dt>Requests</dt>
                      <dd>
                        {a.requests} since the proxy started{a.failures > 0 && <span className="minus"> · {a.failures} failed</span>}
                      </dd>
                      <dt>Last used</dt>
                      <dd>{a.last_used ? `${span(now - Date.parse(a.last_used))} ago` : "not since the proxy started"}</dd>
                      {token && (
                        <>
                          <dt>Sign-in</dt>
                          <dd>{token}</dd>
                        </>
                      )}
                      <dt>Priority</dt>
                      <dd>
                        <input
                          className="priority"
                          type="number"
                          key={a.priority}
                          defaultValue={a.priority}
                          disabled={!!working}
                          aria-label="Priority"
                          title="Accounts with a higher priority take new sessions first"
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                          onBlur={(e) => {
                            const next = Math.trunc(Number(e.currentTarget.value));
                            if (Number.isFinite(next) && next !== a.priority) act(a.id, "Saving…", () => setAccountPriority(def, a.id, next).then(() => `Priority set to ${next}.`));
                          }}
                        />
                        <span className="muted"> higher takes new sessions first</span>
                      </dd>
                    </dl>

                    <div className="account-actions">
                      <button disabled={!!working} onClick={() => act(a.id, a.disabled ? "Enabling…" : "Disabling…", () => setAccountDisabled(def, a.id, !a.disabled).then(() => (a.disabled ? "Back in rotation." : "Out of rotation.")))}>
                        {a.disabled ? "Enable" : "Disable"}
                      </button>
                      {a.kind === "oauth" && (
                        <button disabled={!!working} title="Renew the saved sign-in and read the usage again" onClick={() => act(a.id, "Refreshing…", () => refreshAccount(def, a.id).then(() => "Sign-in renewed."))}>
                          <Icon name="refresh" size={13} /> Refresh sign-in
                        </button>
                      )}
                      {a.kind === "oauth" && ["codex", "claude", "meta", "kiro"].includes(a.provider) && (
                        <button disabled={!!working} onClick={() => act(a.id, "Reading usage…", () => refreshAccountUsage(def, a.id).then(() => "Usage read again."))}>
                          Refresh usage
                        </button>
                      )}
                      <button
                        disabled={!!working || a.disabled}
                        title="Sends one tiny real request on the account's cheapest model. It uses a little quota."
                        onClick={() =>
                          act(a.id, "Testing…", async () => {
                            const t = await testAccount(def, a.id);
                            if (!t.ok) throw new Error(`${t.model}: ${t.error || `answered ${t.status}`}`);
                            return `${t.model} answered in ${t.ms} ms.`;
                          })
                        }
                      >
                        Test
                      </button>
                      {a.last_error && a.last_error_id && (
                        <button disabled={!!working} onClick={() => act(a.id, "Clearing…", () => clearAccountError(def, a.id, a.last_error_id!).then(() => "Error cleared."))}>
                          Clear the error
                        </button>
                      )}
                      <span className="grow" />
                      <button className="danger" disabled={!!working} onClick={() => remove(a)} title={a.kind === "oauth" ? "Deletes the saved sign-in from the proxy" : "Deletes the key from the proxy's config"}>
                        {removing === a.id ? "Click again to remove" : "Remove"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
