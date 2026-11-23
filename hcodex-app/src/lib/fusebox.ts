/** Fusebox's management API (`/api/*`), the one its own dashboard uses. */
import { sh, type ProxyDef } from "./proxies";

/**
 * The app's page is another origin and the API sends no CORS headers, so a request goes out
 * with `curl` on the app-server host, like the other proxy commands. `--noproxy`: an HTTP proxy
 * set for the machine (the office LAN's) answers 503 for 127.0.0.1. The status code is the
 * last line of the output.
 */
const CALL = `if [ -n "\${4-}" ]; then
  exec curl -sS -m 30 --noproxy '*' -X "$2" -H 'content-type: application/json' --data-binary "$4" -w '\\n%{http_code}' -- "$1/api/$3"
fi
exec curl -sS -m 30 --noproxy '*' -X "$2" -w '\\n%{http_code}' -- "$1/api/$3"`;

/** `status` is the HTTP status, or 0 when the proxy could not be reached. */
export class FuseboxError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(def: ProxyDef, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  const r = await sh(CALL, [def.url.replace(/\/+$/, ""), method, path, body === undefined ? "" : JSON.stringify(body)], 40000);
  if (r.exitCode !== 0) {
    throw new FuseboxError(r.stderr.trim().replace(/^curl: \(\d+\) /, "") || `${def.name} does not answer at ${def.url}.`, 0);
  }
  const cut = r.stdout.lastIndexOf("\n");
  const status = Number(r.stdout.slice(cut + 1));
  let data: unknown = null;
  try {
    data = JSON.parse(r.stdout.slice(0, cut));
  } catch {
    // Not JSON: an error page from something else on that port.
  }
  if (!(status >= 200 && status < 300)) {
    const said = data && typeof data === "object" ? (data as { error?: unknown }).error : null;
    throw new FuseboxError(typeof said === "string" && said ? said : `${def.name} answered ${status}.`, status);
  }
  return data as T;
}

// ---------------------------------------------------------------------------- accounts

export type UsageWindow = { name: string; used: number; resets_at: string | null };

export type UsageLimit = {
  id: string;
  name: string;
  used_percent: number | null;
  used: number | null;
  limit: number | null;
  remaining: number | null;
  unit: string | null;
  unlimited: boolean | null;
  resets_at: string | null;
};

export type Account = {
  id: string;
  provider: string;
  /** What the account is called: its e-mail address for a sign-in. */
  label: string;
  kind: string;
  disabled: boolean;
  /** Model (or `*` for the whole account) to the time it is usable again. */
  cooldowns: Record<string, string>;
  cooldown_kinds: Record<string, string>;
  quota_reset_unknown: boolean;
  last_error: string | null;
  /** Names the error shown, so clearing it cannot wipe a newer one. */
  last_error_id: string | null;
  last_used: string | null;
  expires_at: string | null;
  priority: number;
  plan: string | null;
  windows: UsageWindow[];
  limits: UsageLimit[];
  requests: number;
  failures: number;
  models: number;
};

type RawAccount = Omit<Account, "plan" | "windows" | "limits" | "requests" | "failures" | "models"> & {
  quota?: { plan?: string | null; windows?: UsageWindow[]; limits?: UsageLimit[] } | null;
  counters?: { requests?: number; failures?: number } | null;
  models?: string[] | null;
};

/** Only what the page shows is kept; the rest of the answer is dropped here. */
export async function listAccounts(def: ProxyDef): Promise<Account[]> {
  const raw = await call<RawAccount[]>(def, "GET", "accounts");
  return raw.map((a) => ({
    id: a.id,
    provider: a.provider,
    label: a.label,
    kind: a.kind,
    disabled: a.disabled,
    cooldowns: a.cooldowns ?? {},
    cooldown_kinds: a.cooldown_kinds ?? {},
    quota_reset_unknown: !!a.quota_reset_unknown,
    last_error: a.last_error || null,
    last_error_id: a.last_error_id ?? null,
    last_used: a.last_used,
    expires_at: a.expires_at,
    priority: a.priority ?? 0,
    plan: a.quota?.plan ?? null,
    windows: a.quota?.windows ?? [],
    limits: a.quota?.limits ?? [],
    requests: a.counters?.requests ?? 0,
    failures: a.counters?.failures ?? 0,
    models: a.models?.length ?? 0,
  }));
}

export type AccountState = {
  tone: "ok" | "warn" | "err" | "off";
  word: string;
  /** The model that is cooling, when it is not the whole account. */
  model?: string;
  /** When the account is usable again. */
  until?: string;
  /** The provider refused the saved sign-in: only signing in again brings it back. */
  signIn?: boolean;
};

const SIGN_IN = /invalid_grant|refresh token|sign in again|re-?authenticat|unauthori[sz]ed|\b401\b|token (?:has )?expired|expired token|revoked/i;

/** The same reading of an account as Fusebox's dashboard: off, cooling, failing or ready. */
export function accountState(a: Account, now = Date.now()): AccountState {
  if (a.disabled) return { tone: "off", word: "Disabled" };
  const cooling = Object.entries(a.cooldowns)
    .filter(([, until]) => Date.parse(until) > now)
    .sort((x, y) => Date.parse(y[1]) - Date.parse(x[1]));
  if (cooling.length) {
    // The whole account first; otherwise the model that is out for longest.
    const [model, until] = cooling.find(([m]) => m === "*") ?? cooling[0];
    const kind = a.cooldown_kinds[model] ?? "rate_limit";
    const whole = model === "*";
    if (kind === "credit") return { tone: "err", word: "Out of credit", until, model: whole ? undefined : model };
    if (kind === "quota" && whole) return { tone: "warn", word: "Quota used up", until: a.quota_reset_unknown ? undefined : until };
    return { tone: "warn", word: "Cooling", until, model: whole ? undefined : model };
  }
  if (a.last_error) {
    const signIn = a.kind !== "api-key" && SIGN_IN.test(a.last_error);
    return { tone: "err", word: signIn ? "Sign-in expired" : "Error", signIn };
  }
  return { tone: "ok", word: "Ready" };
}

const account = (id: string) => `accounts/${encodeURIComponent(id)}`;

export const setAccountDisabled = (def: ProxyDef, id: string, disabled: boolean) => call(def, "POST", `${account(id)}/toggle`, { disabled });
/** Renew the saved sign-in and read the usage again. */
export const refreshAccount = (def: ProxyDef, id: string) => call(def, "POST", `${account(id)}/refresh`);
export const refreshAccountUsage = (def: ProxyDef, id: string) => call(def, "POST", `${account(id)}/quota/refresh`);
export const clearAccountError = (def: ProxyDef, id: string, errorId: string) => call(def, "POST", `${account(id)}/error/clear`, { error_id: errorId });
export const setAccountPriority = (def: ProxyDef, id: string, priority: number) => call(def, "POST", `${account(id)}/priority`, { priority });
/** Forget the account: its saved sign-in file, or its key in the config. */
export const removeAccount = (def: ProxyDef, id: string) => call(def, "DELETE", account(id));

export type AccountTest = { ok: boolean; status: number; model: string; ms: number; reply: string; error: string | null };
/** One tiny real request on the account's cheapest model. It uses a little of the account's quota. */
export const testAccount = (def: ProxyDef, id: string) => call<AccountTest>(def, "POST", `${account(id)}/test`);

// ---------------------------------------------------------------------------- settings

export type SettingDef = { key: string; label: string; help: string } & (
  | { kind: "bool" }
  | { kind: "number"; min: number; max: number; unit?: string }
  | { kind: "choice"; options: Array<[value: string, label: string]> }
);

/**
 * The settings the app edits: plain switches, numbers and choices. Keys, clients, TLS and
 * webhooks are left to Fusebox's own dashboard, so no secret is read into this page.
 */
export const SETTING_GROUPS: Array<{ title: string; settings: SettingDef[] }> = [
  {
    title: "Routing",
    settings: [
      {
        key: "routing",
        label: "New sessions go to",
        help: "Which account takes a new session.",
        kind: "choice",
        options: [
          ["least-used", "The account with most quota left"],
          ["smart-quota", "The earliest weekly renewal first"],
          ["round-robin", "Each account in turn"],
          ["fill-first", "One account until it is used up"],
        ],
      },
      { key: "latency-routing", label: "Break ties by speed", help: "With the weekly-renewal strategy, an exact tie goes to the account that answered fastest lately.", kind: "bool" },
      { key: "five-hour-reserve-percent", label: "Five-hour reserve", help: "Share of a five-hour window the weekly-renewal strategy keeps back. 0 turns the reserve off.", kind: "number", min: 0, max: 100, unit: "%" },
      { key: "session-affinity", label: "Keep a session on one account", help: "A coding session stays on the account it started on, which keeps prompt caching working.", kind: "bool" },
      { key: "session-affinity-idle-seconds", label: "Forget a session after", help: "Time without requests before a session can move to another account. At least 60.", kind: "number", min: 60, max: 31_536_000, unit: "s" },
      { key: "provider-session-idle-seconds", label: "New provider identity after", help: "Idle time before the provider sees a fresh session.", kind: "number", min: 1, max: 86_400, unit: "s" },
    ],
  },
  {
    title: "Requests",
    settings: [
      { key: "request-retry", label: "Tries per request", help: "How many account or model choices one request may go through.", kind: "number", min: 0, max: 10 },
      { key: "first-token-timeout-seconds", label: "Wait for the first token", help: "A stream silent this long moves to the next account. 0 turns it off.", kind: "number", min: 0, max: 86_400, unit: "s" },
    ],
  },
  {
    title: "Providers",
    settings: [
      { key: "codex-websockets", label: "ChatGPT over WebSocket", help: "Relay Codex sessions to ChatGPT over a native WebSocket.", kind: "bool" },
      { key: "claude-cloak", label: "Present as Claude Code", help: "On Claude sign-ins, other clients are presented as Claude Code.", kind: "bool" },
      { key: "claude-subscription-fast-mode", label: "Claude fast mode on subscriptions", help: "Send fast mode to a Claude subscription only when it has usage credits.", kind: "bool" },
      { key: "banked-resets", label: "Banked limit resets", help: "Show and spend banked Claude and ChatGPT limit resets. These use unofficial endpoints.", kind: "bool" },
    ],
  },
  {
    title: "Logging",
    settings: [
      { key: "debug", label: "Debug log", help: "Write debug lines to the proxy's log.", kind: "bool" },
      {
        key: "log-format",
        label: "Log format",
        help: "JSON writes one object per line.",
        kind: "choice",
        options: [
          ["text", "Text"],
          ["json", "JSON"],
        ],
      },
    ],
  },
];

const SETTING_KEYS = SETTING_GROUPS.flatMap((g) => g.settings.map((s) => s.key));

export type SettingValue = string | number | boolean;
export type Settings = {
  /** Of the config file as read; a save names it, so an edit made elsewhere is not overwritten. */
  revision: string;
  /** The config file the proxy reads. */
  path: string;
  values: Record<string, SettingValue>;
  defaults: Record<string, SettingValue>;
  /** What only takes effect after the proxy restarts, e.g. `port`. Empty when nothing waits. */
  restartFields: string[];
};

type RawSettings = {
  revision: string;
  path: string;
  values: Record<string, unknown>;
  defaults: Record<string, unknown>;
  restart_fields?: string[];
};

/** Keep the settings this page edits and nothing else of the config. */
function pick(all: Record<string, unknown>): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const key of SETTING_KEYS) {
    const v = all?.[key];
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[key] = v;
  }
  return out;
}

const settingsOf = (raw: RawSettings): Settings => ({
  revision: raw.revision,
  path: raw.path,
  values: pick(raw.values),
  defaults: pick(raw.defaults),
  restartFields: raw.restart_fields ?? [],
});

export const loadSettings = async (def: ProxyDef) => settingsOf(await call<RawSettings>(def, "GET", "config/settings"));

/** Write the changed settings to the proxy's config file; the proxy applies them at once. */
export async function saveSettings(def: ProxyDef, revision: string, changes: Record<string, SettingValue>): Promise<Settings> {
  const safe = Object.fromEntries(Object.entries(changes).filter(([key]) => SETTING_KEYS.includes(key)));
  return settingsOf(await call<RawSettings>(def, "PATCH", "config/settings", { revision, changes: safe }));
}
