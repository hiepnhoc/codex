import { rpc } from "./rpc";
import { join, readFile } from "./fs";
import type { CommandExecResponse } from "../protocol/v2/CommandExecResponse";
import type { ModelListResponse } from "../protocol/v2/ModelListResponse";

/** A local proxy the harness talks to, run as a launchd job outside the app. */
export type ProxyDef = {
  id: string;
  name: string;
  description: string;
  /** launchd job label, e.g. `com.fusebox.proxy`. */
  label: string;
  /** Where it listens. */
  url: string;
  /** hcodex provider id that points at it; its model list is the reachability check. */
  provider: string;
  /** Log file and installed binary; a leading `~/` is the home folder. */
  log: string;
  bin: string;
};

/** Fusebox ships in this repo (`proxies/fusebox`), so it is known without any config. */
export const DEFAULT_PROXIES: ProxyDef[] = [
  {
    id: "fusebox",
    name: "Fusebox",
    description: "OpenAI, Claude and Gemini compatible proxy over your own accounts.",
    label: "com.fusebox.proxy",
    url: "http://127.0.0.1:8317",
    provider: "hibox",
    log: "~/Library/Logs/fusebox.log",
    bin: "~/.local/bin/fusebox",
  },
];

const FIELDS: Array<keyof ProxyDef> = ["id", "name", "description", "label", "url", "provider", "log", "bin"];

/** `<hcodex home>/proxies.json` (an array of `ProxyDef`) replaces the built-in list when present and valid. */
export async function loadProxies(home: string): Promise<ProxyDef[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(join(home, "proxies.json")));
    if (Array.isArray(parsed) && parsed.length && parsed.every((p) => FIELDS.every((f) => typeof p?.[f] === "string" && p[f]))) {
      return parsed as ProxyDef[];
    }
  } catch {
    // No file, or not valid: use the built-in list.
  }
  return DEFAULT_PROXIES;
}

/**
 * Run a fixed script with values passed as positional arguments, never spliced into the
 * script text. launchd and process queries do not work inside the command sandbox, and
 * these are the app's own commands (not the model's), so they run unsandboxed.
 */
function sh(script: string, args: string[], timeoutMs = 10000): Promise<CommandExecResponse> {
  return rpc.request<CommandExecResponse>("command/exec", {
    command: ["/bin/sh", "-c", script, "proxy", ...args],
    timeoutMs,
    outputBytesCap: 400_000,
    sandboxPolicy: { type: "dangerFullAccess" },
  });
}

const EXPAND = 'expand() { case "$1" in "~/"*) printf "%s/%s" "$HOME" "${1#\\~/}";; *) printf "%s" "$1";; esac; }';

const STATUS_SCRIPT = `${EXPAND}
out=$(launchctl print "gui/$(id -u)/$1" 2>/dev/null) || { echo "state=missing"; exit 0; }
pid=$(printf '%s\\n' "$out" | awk '$1 == "pid" { print $3; exit }')
if [ -n "$pid" ]; then echo "state=running"; echo "pid=$pid"; echo "since=$(ps -o lstart= -p "$pid" 2>/dev/null)"; else echo "state=stopped"; fi
bin=$(expand "$2")
[ -x "$bin" ] && echo "version=$("$bin" --version 2>/dev/null | head -1)"
exit 0`;

export type ProxyStatus = {
  state: "running" | "stopped" | "missing";
  pid: string | null;
  since: string | null;
  version: string | null;
  /** Models the provider lists right now; null when it does not answer. */
  models: number | null;
};

export async function proxyStatus(def: ProxyDef): Promise<ProxyStatus> {
  const [service, models] = await Promise.all([
    sh(STATUS_SCRIPT, [def.label, def.bin]),
    Promise.race([
      rpc.request<ModelListResponse>("model/list", { modelProvider: def.provider, includeHidden: true }).then((r) => r.data.length),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]).catch(() => null),
  ]);
  const fields = new Map(
    service.stdout
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()] as const),
  );
  const state = fields.get("state");
  return {
    state: state === "running" || state === "stopped" ? state : "missing",
    pid: fields.get("pid") || null,
    since: fields.get("since") || null,
    version: fields.get("version") || null,
    models: models || null,
  };
}

export async function proxyLog(def: ProxyDef, lines = 200): Promise<string[]> {
  const r = await sh(`${EXPAND}\ntail -n "$2" "$(expand "$1")"`, [def.log, String(lines)]);
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `cannot read ${def.log}`);
  return r.stdout.split("\n").filter(Boolean);
}

/** Restart the launchd job; launchd starts it again at once. */
export async function restartProxy(def: ProxyDef): Promise<void> {
  const r = await sh('launchctl kickstart -k "gui/$(id -u)/$1"', [def.label]);
  if (r.exitCode !== 0) throw new Error(r.stderr.trim() || `launchctl exited with ${r.exitCode}`);
}

export type LogLine = { time: string; level: "INFO" | "WARN" | "ERROR" | "DEBUG" | ""; text: string };

const LINE = /^(\d{4}-\d\d-\d\dT[\d:.]+Z?)\s+(INFO|WARN|ERROR|DEBUG|TRACE)\s+(.*)$/;
const ACCOUNT = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Account names in the log are other people's too: show two letters unless asked. */
export const maskAccounts = (text: string) => text.replace(ACCOUNT, (m) => `${m.slice(0, 2)}…@…`);

export function parseLog(lines: string[]): LogLine[] {
  return lines.map((coloured) => {
    // The start-up banner is written with terminal colour codes.
    const raw = coloured.replace(/\x1b\[[0-9;]*m/g, "");
    const m = LINE.exec(raw);
    if (!m) return { time: "", level: "", text: raw };
    const level = m[2] === "TRACE" ? "DEBUG" : (m[2] as LogLine["level"]);
    return { time: m[1], level, text: m[3] };
  });
}

export type LogHealth = { warnings: number; errors: number; rateLimited: number; latest: LogLine | null };

export function logHealth(lines: LogLine[]): LogHealth {
  const problems = lines.filter((l) => l.level === "WARN" || l.level === "ERROR");
  return {
    warnings: lines.filter((l) => l.level === "WARN").length,
    errors: lines.filter((l) => l.level === "ERROR").length,
    rateLimited: lines.filter((l) => /\b429\b|rate.?limit/i.test(l.text)).length,
    latest: problems.length ? problems[problems.length - 1] : null,
  };
}
