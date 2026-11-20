#!/usr/bin/env bash
# Smoke-test a hcodex binary against the harness contract:
#   1. it runs and reports a version
#   2. the request it sends to a third-party provider does not open by calling itself
#      Codex / OpenAI / GPT (offline: a local recording server stands in for the provider)
#   3. `/model` data comes from the provider (GET {base_url}/models), not the OpenAI catalog
#   4. a turn round-trips through the default provider (local proxy)
#   5. a turn round-trips through each provider/model pair listed in
#      ~/.hcodex/smoke-turns.txt (lines `provider model`), using the real ~/.hcodex config
#
# Checks 4 and 5 first ask the provider directly with a tiny request. A provider that does
# not answer that is down or out of quota: reported as WARN, not a harness fault. A provider
# that answers directly but fails through hcodex is the harness's fault: FAIL.
#
# Usage: scripts/harness-smoke.sh [path/to/hcodex]   (default: hcodex on PATH)
#   env HCODEX_SMOKE_TURNS="hibox:gemini-3.8-flash-high,hibox:claude-haiku-5-5"  overrides the file
#   env HCODEX_SMOKE_TURN_TIMEOUT=90   seconds allowed for one hcodex turn
set -euo pipefail

BIN="${1:-hcodex}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORIG_PWD="$PWD"
REAL_HOME="$HOME/.hcodex"
PROXY="${HCODEX_PROXY_URL:-http://127.0.0.1:8181/v1}"
TURN_TIMEOUT="${HCODEX_SMOKE_TURN_TIMEOUT:-90}"
PROMPT="Reply with exactly: pong"
TMP="$(mktemp -d)"
RECORDER_PID=""
cleanup() { [[ -n "$RECORDER_PID" ]] && kill "$RECORDER_PID" 2>/dev/null; rm -rf "$TMP"; return 0; }
trap cleanup EXIT
export CODEX_HOME="$TMP/home"
mkdir -p "$CODEX_HOME" "$TMP/cwd" "$TMP/rec"
cd "$TMP/cwd"
FAILED=0

echo "binary: $("$BIN" --version)"

# Run a command with a wall-clock limit (macOS has no `timeout` by default).
limited() {
  local secs="$1"; shift
  "$@" & local pid=$!
  ( sleep "$secs"; kill "$pid" 2>/dev/null ) & local watcher=$!
  local rc=0; wait "$pid" 2>/dev/null || rc=$?
  kill "$watcher" 2>/dev/null; wait "$watcher" 2>/dev/null || true
  return "$rc"
}

# HTTP status of a tiny streamed Responses request sent straight to a provider.
direct_status() {   # base_url key model
  local auth=(); [[ -n "$2" ]] && auth=(-H "Authorization: Bearer $2")
  curl -s -m 60 -o "$TMP/direct.txt" -w '%{http_code}' "$1/responses" ${auth[@]+"${auth[@]}"} \
    -H 'content-type: application/json' -H 'accept: text/event-stream' \
    -d "{\"model\":\"$3\",\"stream\":true,\"input\":[{\"role\":\"user\",\"content\":[{\"type\":\"input_text\",\"text\":\"$PROMPT\"}]}]}" \
    || echo 000
}

# ---------------------------------------------------------------- 2. request identity (offline)
# A provider that is not OpenAI must not be told "you are running in the Codex CLI ... led by
# OpenAI": Google answers a Gemini request that opens like that with 429 "Resource has been
# exhausted" (20/11/2026). hcodex replaces that opening; this fails when it stops doing so, for
# example after upstream rewords its default prompt.
cat > "$TMP/recorder.py" <<'EOF'
import http.server, json, os, sys
out, models = sys.argv[1], sys.argv[2].split(',')
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status); self.send_header('content-type', 'application/json')
        self.send_header('content-length', str(len(data))); self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        self.reply(200, {'object': 'list', 'data': [{'id': m, 'object': 'model'} for m in models]})
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('content-length', 0)))
        try: model = json.loads(body).get('model', 'unknown')
        except Exception: model = 'unparsed'
        open(os.path.join(out, model.replace('/', '_') + '.json'), 'wb').write(body)
        self.reply(400, {'error': {'message': 'recorded by harness-smoke', 'type': 'invalid_request_error'}})
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
open(os.path.join(out, 'port'), 'w').write(str(server.server_address[1]))
server.serve_forever()
EOF
IDENTITY_MODELS="gemini-3.8-flash-high claude-sonnet-5.5 gpt-6.1-terra"
python3 -I "$TMP/recorder.py" "$TMP/rec" "${IDENTITY_MODELS// /,}" & RECORDER_PID=$!
for _ in $(seq 1 50); do [[ -s "$TMP/rec/port" ]] && break; sleep 0.1; done
REC_URL="http://127.0.0.1:$(cat "$TMP/rec/port")/v1"
for model in $IDENTITY_MODELS; do
  NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost limited 60 "$BIN" exec --skip-git-repo-check --ephemeral -m "$model" \
    -c model_provider=smoke -c model_providers.smoke.name=smoke -c "model_providers.smoke.base_url=$REC_URL" \
    -c model_providers.smoke.wire_api=responses -c model_providers.smoke.requires_openai_auth=false \
    "$PROMPT" </dev/null >"$TMP/rec/$model.out" 2>&1 || true
done
kill "$RECORDER_PID" 2>/dev/null; wait "$RECORDER_PID" 2>/dev/null || true; RECORDER_PID=""
if ! python3 -I - "$TMP/rec" $IDENTITY_MODELS <<'EOF'
import json, os, re, sys
rec, models = sys.argv[1], sys.argv[2:]
bad = 0
for model in models:
    path = os.path.join(rec, model.replace('/', '_') + '.json')
    if not os.path.exists(path):
        print(f'FAIL: hcodex sent no request for {model} to the recording provider'); bad += 1; continue
    body = json.load(open(path))
    system = [body.get('instructions') or '']
    for item in body.get('input', []):
        if item.get('role') in ('developer', 'system'):
            system.append(''.join(part.get('text', '') for part in item.get('content', []) if isinstance(part, dict)))
    system = [text for text in system if text.strip()]
    opening = system[0].strip().split('\n\n')[0] if system else ''
    if not opening:
        print(f'FAIL: request for {model} carries no system prompt'); bad += 1
    # `\bcodex\b` does not match the harness's own name, "hcodex".
    elif re.search(r'\bcodex\b|openai|\bgpt', opening, re.I):
        print(f'FAIL: system prompt for {model} opens with an OpenAI identity: {opening[:160]!r}'); bad += 1
sys.exit(1 if bad else 0)
EOF
then
  FAILED=1
else
  echo "request identity: neutral opening for $(wc -w <<<"$IDENTITY_MODELS" | tr -d ' ') model families"
fi

# ---------------------------------------------------------------- 3 + 4. default provider
if ! curl -fsS -m 3 "$PROXY/models" -o "$TMP/models.json"; then
  echo "WARN: default proxy $PROXY not reachable; skipping its model list and turn"
else
  want="$(python3 -c "import json;print(len(json.load(open('$TMP/models.json'))['data']))")"

  # model listing via app-server (same path the TUI /model uses)
  node - "$BIN" <<'EOF' > "$TMP/list.txt" || true
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
  DEFAULT_MODEL="${HCODEX_DEFAULT_MODEL:-claude-sonnet-5.5}"   # LOCAL_PROXY_DEFAULT_MODEL in model-provider-info
  if grep -q "TIMEOUT\|ERROR" "$TMP/list.txt" || [[ "$got" -lt 1 ]]; then
    echo "FAIL: model/list returned nothing usable:"; cat "$TMP/list.txt"; FAILED=1
  elif ! grep -qx "$DEFAULT_MODEL" "$TMP/list.txt"; then
    echo "FAIL: proxy default model $DEFAULT_MODEL missing from model/list (got $got models):"; head "$TMP/list.txt"; FAILED=1
  else
    echo "model/list: $got models from provider (proxy reports $want)"
  fi

  # one real turn, unless the proxy itself cannot serve the model right now
  status="$(direct_status "$PROXY" "" "$DEFAULT_MODEL")"
  if [[ "$status" != "200" ]]; then
    echo "WARN: default proxy answers HTTP $status for $DEFAULT_MODEL when asked directly; skipping the turn (provider side, not hcodex)"
    head -c 200 "$TMP/direct.txt" | tr '\n' ' '; echo
  else
    out="$(limited "$TURN_TIMEOUT" "$BIN" exec --skip-git-repo-check "$PROMPT" </dev/null 2>&1 | sed 's/\x1b\[[0-9;]*m//g' || true)"
    if ! grep -q "provider: local-proxy" <<<"$out" || ! grep -qi "pong" <<<"$out"; then
      echo "FAIL: the proxy answers $DEFAULT_MODEL directly, but the exec turn through local-proxy did not answer 'pong':"; echo "$out" | tail -15; FAILED=1
    else
      echo "exec turn: ok ($(grep -m1 '^model:' <<<"$out"))"
    fi
  fi
fi

# ---------------------------------------------------------------- 5. turns through other providers
# Uses the real ~/.hcodex (providers and their credentials live there), not the throwaway home.
TURNS="${HCODEX_SMOKE_TURNS:-}"
if [[ -z "$TURNS" && -f "$REAL_HOME/smoke-turns.txt" ]]; then
  TURNS="$(grep -vE '^\s*(#|$)' "$REAL_HOME/smoke-turns.txt" | awk '{print $1 ":" $2}' | paste -sd, -)"
fi
if [[ -z "$TURNS" ]]; then
  echo "provider turns: none listed (add lines 'provider model' to $REAL_HOME/smoke-turns.txt)"
else
  IFS=',' read -r -a PAIRS <<<"$TURNS"
  for pair in "${PAIRS[@]}"; do
    provider="${pair%%:*}"; model="${pair#*:}"
    base_url="$(python3 -I - "$REAL_HOME/config.toml" "$provider" <<'EOF' 2>/dev/null || true
import sys, tomllib
config = tomllib.load(open(sys.argv[1], 'rb'))
print(config.get('model_providers', {}).get(sys.argv[2], {}).get('base_url', ''))
EOF
)"
    if [[ -z "$base_url" ]]; then
      echo "WARN: $provider/$model: no [model_providers.$provider] base_url in $REAL_HOME/config.toml; skipped"; continue
    fi
    key="$(env -u CODEX_HOME "$BIN" provider-credential "$provider" 2>/dev/null || true)"
    status="$(direct_status "$base_url" "$key" "$model")"
    if [[ "$status" != "200" ]]; then
      echo "WARN: $provider/$model: provider answers HTTP $status when asked directly; skipped (provider side, not hcodex)"
      continue
    fi
    started=$SECONDS
    limited "$TURN_TIMEOUT" env -u CODEX_HOME "$BIN" exec --skip-git-repo-check --ephemeral -c "model_provider=$provider" -m "$model" \
      -o "$TMP/last.txt" "$PROMPT" </dev/null >"$TMP/turn.out" 2>&1 || true
    if grep -qi "pong" "$TMP/last.txt" 2>/dev/null; then
      echo "provider turn: ok $provider/$model ($((SECONDS - started))s)"
    else
      echo "FAIL: $provider/$model answers directly, but the turn through hcodex did not answer 'pong' within ${TURN_TIMEOUT}s:"
      sed 's/\x1b\[[0-9;]*m//g' "$TMP/turn.out" | grep -E "ERROR|error|Reconnecting|429|exhausted" | tail -5 || true
      FAILED=1
    fi
    rm -f "$TMP/last.txt"
  done
fi

# plugin hooks still trusted? (upstream fingerprints the plugin dir; a marketplace
# re-sync silently disables every hook until re-approved). Warn only: not a build fault.
# Uses the real ~/.hcodex (not the throwaway CODEX_HOME above) and the caller's cwd.
if [[ -x "$HERE/hc-approve-hooks.sh" ]]; then
  hooks="$(env -u CODEX_HOME HCODEX_BIN="$BIN" "$HERE/hc-approve-hooks.sh" --dry-run "$ORIG_PWD" 2>&1 || true)"
  if grep -q "^approving" <<<"$hooks"; then
    echo "WARN: plugin hooks need re-approval (run scripts/hc-approve-hooks.sh):"; grep "^  " <<<"$hooks"
  else
    echo "hooks: $(grep -c "^trusted" <<<"$hooks") trusted, none pending"
  fi
fi

if [[ "$FAILED" != "0" ]]; then
  echo "smoke: FAIL"
  exit 1
fi
echo "smoke: PASS"
