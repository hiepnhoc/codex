#!/usr/bin/env bash
# Build, install and update Fusebox, the local proxy kept in proxies/fusebox/ (hcodex provider "hibox").
#
#   scripts/fusebox.sh status          service state, installed / source versions, models served
#   scripts/fusebox.sh build           cargo build --release (binary: proxies/fusebox/target/release/fusebox)
#   scripts/fusebox.sh install         build, back up the installed binary, replace it, restart the service,
#                                      check that it serves models; puts the old binary back if it does not
#   scripts/fusebox.sh restart         restart the launchd service
#   scripts/fusebox.sh rollback        reinstall the binary backed up by the last install
#   scripts/fusebox.sh logs [n]        last n lines of the service log (default 40)
#   scripts/fusebox.sh sync --check    say whether upstream has a release newer than the one this tree is based on
#   scripts/fusebox.sh sync [tag]      apply upstream's changes since that release to proxies/fusebox (3-way merge),
#                                      staged but not committed (default: the newest v* tag)
#
#   env FUSEBOX_BIN       installed binary        (default ~/.local/bin/fusebox, what the launchd job runs)
#   env FUSEBOX_LABEL     launchd job label       (default com.fusebox.proxy)
#   env FUSEBOX_URL       where the proxy listens (default http://127.0.0.1:8317)
#   env FUSEBOX_PROVIDER  hcodex provider id whose credential opens the proxy (default hibox)
#   env FUSEBOX_UPSTREAM_URL  fetch upstream from here instead of the URL in proxies/fusebox.upstream
set -euo pipefail

ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
SRC="$ROOT/proxies/fusebox"
META="$ROOT/proxies/fusebox.upstream"
BIN="${FUSEBOX_BIN:-$HOME/.local/bin/fusebox}"
LABEL="${FUSEBOX_LABEL:-com.fusebox.proxy}"
URL="${FUSEBOX_URL:-http://127.0.0.1:8317}"
PROVIDER="${FUSEBOX_PROVIDER:-hibox}"
BACKUP="$HOME/.hcodex/backup/fusebox"
LOG="$HOME/Library/Logs/fusebox.log"
BUILT="$SRC/target/release/fusebox"
# The office LAN's HTTP proxy answers 503 for 127.0.0.1.
export NO_PROXY=127.0.0.1,localhost no_proxy=127.0.0.1,localhost

say() { printf '\n== %s\n' "$*"; }
meta() { sed -n "s/^$1=//p" "$META"; }
version_of() { [[ -x "$1" ]] && "$1" --version 2>/dev/null | head -1 || echo "(none)"; }

# HTTP status and model count of GET /v1/models, e.g. "200 59". The key never leaves this function.
models() {
  local key body status
  key="$(hcodex provider-credential "$PROVIDER" 2>/dev/null || true)"
  body="$(mktemp)"
  status="$(curl -s -m 8 -o "$body" -w '%{http_code}' ${key:+-H "Authorization: Bearer $key"} "$URL/v1/models" || true)"
  echo "${status:-000} $(python3 -c "import json,sys; print(len(json.load(open(sys.argv[1])).get('data', [])))" "$body" 2>/dev/null || echo 0)"
  rm -f "$body"
}

service_pid() { launchctl list 2>/dev/null | awk -v label="$LABEL" '$3 == label { print $1 }'; }

status() {
  local pid; pid="$(service_pid)"
  if [[ -z "$pid" ]]; then echo "service:   $LABEL is not loaded in launchd"
  elif [[ "$pid" == "-" ]]; then echo "service:   $LABEL is loaded but not running"
  else echo "service:   $LABEL running, pid $pid"; fi
  echo "installed: $(version_of "$BIN")  ($BIN)"
  echo "source:    fusebox $(sed -n 's/^version = "\(.*\)"/\1/p' "$SRC/Cargo.toml" | head -1), based on upstream $(meta ref)"
  [[ -x "$BUILT" ]] && echo "built:     $(version_of "$BUILT")"
  read -r code count <<<"$(models)"
  if [[ "$code" == "200" ]]; then echo "proxy:     $URL serves $count models"
  else echo "proxy:     $URL/v1/models answered HTTP $code"; fi
}

build() {
  say "build fusebox (release)"
  # build.rs reads the commit from .git of its own folder, which a sub-folder of this repo
  # does not have: hand it the last commit that touched the proxy.
  (cd "$SRC" && FUSEBOX_COMMIT="$(git -C "$ROOT" log -1 --format=%h -- proxies/fusebox)" \
    nice -n "${BUILD_NICE:-15}" cargo build --release -j "${BUILD_JOBS:-4}")
  echo "built: $(version_of "$BUILT")"
}

restart() {
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  local code count i
  for i in $(seq 1 20); do
    read -r code count <<<"$(models)"
    [[ "$code" == "200" && "$count" -gt 0 ]] && { echo "proxy is up: $count models"; return 0; }
    sleep 1
  done
  echo "proxy did not serve models within 20 s (last answer: HTTP $code)"; return 1
}

put() {  # put <binary>: replace the installed binary atomically
  mkdir -p "$(dirname "$BIN")"
  cp -f "$1" "$BIN.new" && mv -f "$BIN.new" "$BIN"
}

install() {
  build
  say "install"
  mkdir -p "$(dirname "$BACKUP")"
  [[ -x "$BIN" ]] && cp -f "$BIN" "$BACKUP" && echo "backed up $(version_of "$BACKUP") to $BACKUP"
  put "$BUILT"
  echo "installed $(version_of "$BIN")"
  if ! restart; then
    echo "putting the previous binary back"
    [[ -x "$BACKUP" ]] && put "$BACKUP" && restart || true
    exit 1
  fi
}

rollback() {
  [[ -x "$BACKUP" ]] || { echo "no backup at $BACKUP"; exit 1; }
  put "$BACKUP"; echo "restored $(version_of "$BIN")"; restart
}

sync() {
  local url ref base want new
  url="${FUSEBOX_UPSTREAM_URL:-$(meta url)}"; ref="$(meta ref)"; base="$(meta commit)"
  cd "$ROOT"
  # A private ref namespace: Fusebox's v* tags must not land among this repo's own tags.
  git fetch -q --no-tags "$url" '+refs/tags/v*:refs/fusebox/tags/v*'
  want="${1:-}"
  if [[ -z "$want" || "$want" == "--check" ]]; then
    new="$(git for-each-ref --sort=-version:refname --format='%(refname:lstrip=3)' 'refs/fusebox/tags/v*' | grep -Ev -- '-(rc|beta|alpha)' | head -1)"
  else
    new="$want"
  fi
  local target; target="$(git rev-parse --verify -q "refs/fusebox/tags/$new^{commit}")" || { echo "no upstream tag $new"; exit 1; }
  if [[ "$target" == "$base" ]]; then echo "fusebox: up to date with upstream $ref"; return 0; fi
  echo "fusebox: based on $ref, upstream has $new ($(git rev-list --count "$base..$target") commits, $(git diff --name-only "$base" "$target" | wc -l | tr -d ' ') files)"
  [[ "$want" == "--check" ]] && return 0
  if [[ -n "$(git status --porcelain -- proxies/fusebox)" ]]; then
    echo "proxies/fusebox has uncommitted changes; commit or stash them first"; exit 1
  fi
  say "apply upstream $ref..$new to proxies/fusebox"
  local rc=0
  git diff --binary "$base" "$target" | git apply --3way --directory=proxies/fusebox || rc=$?
  sed -i '' -e "s/^ref=.*/ref=$new/" -e "s/^commit=.*/commit=$target/" "$META"
  git add "$META"
  if [[ $rc -ne 0 ]]; then
    echo "conflicts with our own changes, marked in these files:"; git diff --name-only --diff-filter=U
    echo "resolve them, then: scripts/fusebox.sh build && (cd proxies/fusebox && cargo test) && git commit"
    exit 2
  fi
  echo "applied cleanly and staged. Next: scripts/fusebox.sh build && (cd proxies/fusebox && cargo test), then commit and scripts/fusebox.sh install"
}

case "${1:-status}" in
  status) status ;;
  build) build ;;
  install) install ;;
  restart) restart ;;
  rollback) rollback ;;
  logs) tail -n "${2:-40}" "$LOG" ;;
  sync) shift; sync "$@" ;;
  *) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 1 ;;
esac
