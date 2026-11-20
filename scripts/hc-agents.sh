#!/usr/bin/env bash
# hcodex: live view of the main thread and its sub-agents in a separate terminal pane.
# Read-only: tails rollouts under ~/.hcodex/sessions, never talks to a running hcodex.
#
# Usage: scripts/hc-agents.sh                 # newest main session whose cwd starts with $PWD
#        scripts/hc-agents.sh --latest        # newest main session anywhere
#        scripts/hc-agents.sh --session <id>  # a specific session id
# Keys in the pane: ↑↓ scroll · tab/n next · space fold · d details · t tasks/dag · f follow · q quit
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${HCODEX_HOME:-$HOME/.hcodex}/agents-view"
mkdir -p "$STATE_DIR"
sel=(--cwd "$PWD")
if [[ "${1:-}" == "--latest" ]]; then sel=(--latest); elif [[ "${1:-}" == "--session" ]]; then sel=(--session "$2"); fi
STATE="$STATE_DIR/$(printf '%s' "${sel[*]}" | tr -c 'A-Za-z0-9' '_').json"
node "$HERE/hc-agents/tail.mjs" --state "$STATE" "${sel[@]}" &
TAIL=$!
trap 'kill $TAIL 2>/dev/null || true' EXIT
# wait for the first snapshot so the viewer does not start on a missing file
for _ in $(seq 1 50); do [[ -s "$STATE" ]] && break; sleep 0.1; done
node "$HERE/hc-agents/vendor/viewer.mjs" --state "$STATE"
