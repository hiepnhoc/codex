#!/usr/bin/env bash
# hcodex: re-approve plugin hooks whose trust status is Untrusted/Modified.
#
# Upstream (since the 2026-10-23 sync) fingerprints the whole plugin directory
# and refuses to run a hook when the fingerprint no longer matches the approved
# one ("plugin contents changed; hook approval required"). The plugin cache is
# re-synced from the marketplace automatically, so after a plugin update every
# hook silently fails ("hook: UserPromptSubmit Failed" in `hcodex exec`,
# no <openviking-context> recall). This script does the same thing as the TUI
# `/hooks` approval, without the TUI.
#
# Usage: scripts/hc-approve-hooks.sh [--dry-run] [cwd]
set -euo pipefail
DRY=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY=1; shift; fi
CWD="${1:-$PWD}"
BIN="${HCODEX_BIN:-$HOME/.cargo/bin/hcodex}"
exec node - "$BIN" "$CWD" "$DRY" <<'JS'
const { spawn } = require("node:child_process");
const [bin, cwd, dry] = process.argv.slice(2);
const child = spawn(bin, ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
let id = 0; const pending = new Map(); let buf = "";
child.stdout.on("data", (d) => {
  buf += d; let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.id !== undefined && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id); pending.delete(m.id);
      m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
    }
  }
});
const req = (method, params) => new Promise((res, rej) => {
  const rid = ++id; pending.set(rid, { res, rej });
  child.stdin.write(JSON.stringify({ id: rid, method, params }) + "\n");
});
(async () => {
  await req("initialize", { clientInfo: { name: "hc-approve-hooks", title: "hooks", version: "0" } });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const list = await req("hooks/list", { cwds: [cwd] });
  const entry = list.data.find((e) => e.cwd === cwd) || list.data[0] || { hooks: [], warnings: [], errors: [] };
  for (const w of entry.warnings || []) console.log("warning:", w);
  for (const e of entry.errors || []) console.log("error:", e);
  const rows = entry.hooks.map((h) => `${h.trustStatus.padEnd(9)} enabled=${String(h.enabled).padEnd(5)} ${h.key}`);
  console.log(rows.join("\n") || "(no hooks)");
  const toApprove = entry.hooks.filter((h) => h.enabled && !h.isManaged && ["untrusted", "modified"].includes(h.trustStatus));
  if (toApprove.length === 0) { console.log("nothing to approve"); child.kill(); return; }
  console.log(`\napproving ${toApprove.length} hook(s)${dry === "1" ? " (dry run)" : ""}:`);
  for (const h of toApprove) console.log(`  ${h.key} -> ${h.currentHash}`);
  if (dry === "1") { child.kill(); return; }
  const value = Object.fromEntries(toApprove.map((h) => [h.key, { trusted_hash: h.currentHash }]));
  const out = await req("config/batchWrite", {
    edits: [{ keyPath: "hooks.state", value, mergeStrategy: "upsert" }],
    reloadUserConfig: true,
  });
  console.log("written:", out.filePath || JSON.stringify(out).slice(0, 200));
  const after = await req("hooks/list", { cwds: [cwd] });
  const e2 = after.data.find((e) => e.cwd === cwd) || after.data[0];
  const still = e2.hooks.filter((h) => h.enabled && ["untrusted", "modified"].includes(h.trustStatus));
  console.log(still.length ? `STILL untrusted: ${still.map((h) => h.key).join(", ")}` : "all enabled hooks trusted");
  child.kill();
})().catch((e) => { console.error("failed:", e.message); child.kill(); process.exit(1); });
JS
