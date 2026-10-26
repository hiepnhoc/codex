#!/usr/bin/env bash
# hcodex: update marketplace plugins by hand (startup auto-upgrade is off via
# `[features] plugin_marketplace_auto_upgrade = false`), show what changed, re-approve
# the hooks, and verify a turn still runs the hooks.
#
# Usage: scripts/hc-update-plugins.sh [marketplace] [cwd]   (default: openviking, $PWD)
set -euo pipefail
MARKET="${1:-openviking}"
CWD="${2:-$PWD}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="${HCODEX_BIN:-$HOME/.cargo/bin/hcodex}"
HOME_DIR="${CODEX_HOME:-$HOME/.hcodex}"
CACHE="$HOME_DIR/plugins/cache/$MARKET"
SNAP="$(mktemp -d)"
trap 'rm -rf "$SNAP"' EXIT

[[ -d "$CACHE" ]] && cp -R "$CACHE" "$SNAP/before"
echo "== upgrading marketplace '$MARKET'"
"$BIN" plugin marketplace upgrade "$MARKET"

echo "== changes in plugin cache"
if [[ -d "$SNAP/before" ]]; then
  if diff -rq "$SNAP/before" "$CACHE" >"$SNAP/changes.txt" 2>&1; then
    echo "no file changes"
  else
    sed "s#$SNAP/before#before#; s#$CACHE#after#" "$SNAP/changes.txt"
    # hooks.json and scripts are what actually run: show their diff
    while read -r line; do
      f="${line#Files }"; f="${f%% and *}"
      case "$f" in */hooks/hooks.json|*/scripts/*.mjs)
        echo "--- diff ${f#$SNAP/before/}"; diff -u "$f" "$CACHE/${f#$SNAP/before/}" | head -80 || true;;
      esac
    done < <(grep '^Files ' "$SNAP/changes.txt" || true)
  fi
else
  echo "(no previous cache to compare)"
fi

echo "== re-approving hooks"
"$HERE/hc-approve-hooks.sh" "$CWD"

echo "== verifying one turn"
out="$(cd "$CWD" && "$BIN" exec --skip-git-repo-check "Reply with exactly OK" </dev/null 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^hook:' || true)"
echo "$out"
if grep -q "Failed" <<<"$out"; then echo "FAIL: a hook still fails"; exit 1; fi
echo "done: open a new hcodex session to pick up the approved hooks"
