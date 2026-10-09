#!/usr/bin/env bash
# Smoke-test a hcodex binary against the harness contract:
#   1. it runs and reports a version
#   2. `/model` data comes from the provider (GET {base_url}/models), not the OpenAI catalog
#   3. a turn round-trips through the default provider (local proxy) when it is up
#
# Usage: scripts/harness-smoke.sh [path/to/hcodex]   (default: hcodex on PATH)
set -euo pipefail

BIN="${1:-hcodex}"
PROXY="${HCODEX_PROXY_URL:-http://127.0.0.1:8181/v1}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export CODEX_HOME="$TMP/home"
mkdir -p "$CODEX_HOME" "$TMP/cwd"
cd "$TMP/cwd"

echo "binary: $("$BIN" --version)"

if ! curl -fsS -m 3 "$PROXY/models" -o "$TMP/models.json"; then
  echo "proxy $PROXY not reachable — skipping provider/turn checks"
  exit 0
fi
want="$(python3 -c "import json;print(len(json.load(open('$TMP/models.json'))['data']))")"

# model listing via app-server (same path the TUI /model uses)
node - "$BIN" <<'EOF' > "$TMP/list.txt"
const { spawn } = require("node:child_process");
const rl = require("node:readline");
const bin = process.argv[2];
const child = spawn(bin, ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
const lines = rl.createInterface({ input: child.stdout });
let id = 0; const pending = new Map();
const req = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); child.stdin.write(JSON.stringify({ id: i, method, params }) + "\n"); });
lines.on("line", (l) => { const m = JSON.parse(l); if (m.id != null && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
const timer = setTimeout(() => { console.log("TIMEOUT"); child.kill(); process.exit(1); }, 20000);
(async () => {
  await req("initialize", { clientInfo: { name: "harness-smoke", title: "smoke", version: "0" } });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  const r = await req("model/list", {});
  console.log(r.data.map((m) => m.model).join("\n"));
  clearTimeout(timer); child.kill(); process.exit(0);
})().catch((e) => { console.log("ERROR " + e.message); child.kill(); process.exit(1); });
EOF
got="$(grep -c . "$TMP/list.txt" || true)"
if grep -q "TIMEOUT\|ERROR" "$TMP/list.txt" || [[ "$got" -lt 1 ]]; then
  echo "FAIL: model/list returned nothing usable:"; cat "$TMP/list.txt"; exit 1
fi
DEFAULT_MODEL="${HCODEX_DEFAULT_MODEL:-claude-sonnet-5.5}"   # LOCAL_PROXY_DEFAULT_MODEL in model-provider-info
if ! grep -qx "$DEFAULT_MODEL" "$TMP/list.txt"; then
  echo "FAIL: proxy default model $DEFAULT_MODEL missing from model/list (got $got models):"; head "$TMP/list.txt"; exit 1
fi
echo "model/list: $got models from provider (proxy reports $want)"

# one real turn
out="$("$BIN" exec --skip-git-repo-check "Reply with exactly: pong" </dev/null 2>&1 | sed 's/\x1b\[[0-9;]*m//g' || true)"
if ! grep -q "provider: local-proxy" <<<"$out" || ! grep -qi "pong" <<<"$out"; then
  echo "FAIL: exec turn through local-proxy did not answer 'pong':"; echo "$out" | tail -15; exit 1
fi
echo "exec turn: ok ($(grep -m1 '^model:' <<<"$out"))"
echo "smoke: PASS"
