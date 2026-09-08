#!/usr/bin/env bash
# Sync the hcodex harness with openai/codex and reinstall it.
#
#   main        <- fast-forward to upstream/main (never commit here)
#   my-harness  <- rebased on top of main
#   release build -> tests + smoke gate -> install (symlinks in ~/.cargo/bin)
#
# Usage:
#   scripts/sync-upstream.sh              full sync + build + gate + install
#   scripts/sync-upstream.sh --dry-run    fetch and report what would change
#   scripts/sync-upstream.sh --no-build   git sync only
#   scripts/sync-upstream.sh --build-only skip git, just build + gate + install
#   scripts/sync-upstream.sh --rollback   reinstall the binaries backed up by the last run
#   env SKIP_TESTS=1                      skip the cargo test gate (still smoke-tests)
#   env HARNESS_BRANCH=<name>             harness branch (default my-harness)
#
# Every run tags the pre-sync harness commit as harness-pre-sync-<UTC>; undo a
# bad sync with:  git checkout my-harness && git reset --hard <that tag>
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
ROOT="$PWD"
BRANCH="${HARNESS_BRANCH:-my-harness}"
BIN_DIR="$HOME/.cargo/bin"
# hcodex state lives in ~/.hcodex regardless of a CODEX_HOME set by the calling
# shell (some launchers export one); use it for backups and the models cache.
HCODEX_HOME="$HOME/.hcodex"
BACKUP_DIR="$HCODEX_HOME/backup"
if [[ -n "${CODEX_HOME:-}" && "$CODEX_HOME" != "$HCODEX_HOME" ]]; then
  echo "note: CODEX_HOME=$CODEX_HOME is set in this shell; backups/cache still use $HCODEX_HOME" >&2
fi
MODE="${1:-}"

# Files the harness changes vs upstream; upstream commits touching these are
# the ones that can break a rebase or a hook point.
harness_files() {
  git diff --name-only "main...$BRANCH" -- codex-rs scripts 2>/dev/null | grep -v '^docs/' || true
}

say() { printf '\n==> %s\n' "$*"; }

rollback() {
  [[ -x "$BACKUP_DIR/hcodex" ]] || { echo "no backup in $BACKUP_DIR" >&2; exit 1; }
  say "rollback: restoring $BACKUP_DIR/* into $BIN_DIR"
  cp -f "$BACKUP_DIR/hcodex" "$BIN_DIR/hcodex"
  cp -f "$BACKUP_DIR/codex-code-mode-host" "$BIN_DIR/codex-code-mode-host"
  rm -f "$HCODEX_HOME/models_cache.json"
  echo "restored: $("$BIN_DIR/hcodex" --version) (next sync re-links target/release)"
  exit 0
}
[[ "$MODE" == "--rollback" ]] && rollback

git_sync() {
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "working tree has uncommitted changes — commit or stash first (untracked files are fine)" >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi
  git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/openai/codex.git
  # Remember conflict resolutions so a re-run (or a re-rebase) replays them.
  git config rerere.enabled true

  say "fetch upstream"
  git fetch upstream --prune
  local behind
  behind="$(git rev-list --count main..upstream/main)"
  echo "main is $behind commit(s) behind upstream/main"

  local touched
  touched="$(git log --oneline main..upstream/main -- $(harness_files) | wc -l | tr -d ' ')"
  echo "upstream commits touching harness files: $touched"
  if [[ "$MODE" == "--dry-run" ]]; then
    git log --oneline main..upstream/main -- $(harness_files) | head -30 | cat
    echo
    echo "harness files:"; harness_files | sed 's/^/  /'
    exit 0
  fi
  [[ "$behind" == "0" ]] && { echo "already up to date"; return 0; }

  local tag="harness-pre-sync-$(date -u +%Y%m%dT%H%M%SZ)"
  git tag -f "$tag" "$BRANCH" >/dev/null
  echo "tagged current $BRANCH as $tag (rollback: git reset --hard $tag)"

  say "update main"
  git checkout -q main
  git merge --ff-only upstream/main
  git push -q origin main 2>/dev/null || echo "(skip push main to origin)"

  say "rebase $BRANCH onto main"
  git checkout -q "$BRANCH"
  if ! git rebase main; then
    cat >&2 <<MSG

Rebase conflict. Resolve the files above, then:
  git add <files> && git rebase --continue
  scripts/sync-upstream.sh --build-only      # finish build + gate + install
Abort and go back:
  git rebase --abort && git reset --hard $tag
Harness files (the usual suspects):
$(harness_files | sed 's/^/  /')
MSG
    exit 1
  fi
  say "harness commits on top of main:"
  git log --oneline "main..$BRANCH" | cat
}

build_gate_install() {
  cd "$ROOT/codex-rs"
  local v8_dir="$HOME/.cargo/.rusty_v8/codex-v150.4.0"
  if [[ -d "$v8_dir" ]]; then
    export RUSTY_V8_ARCHIVE="$v8_dir/librusty_v8_ptrcomp_sandbox_release_aarch64-apple-darwin.a.gz"
    export RUSTY_V8_SRC_BINDING_PATH="$v8_dir/src_binding_ptrcomp_sandbox_release_aarch64-apple-darwin.rs"
  fi
  local v8_lock
  v8_lock="$(grep -A1 '^name = "v8"$' Cargo.lock | grep version | head -1 | cut -d'"' -f2 || true)"
  if [[ -n "$v8_lock" && "$v8_dir" != *"$v8_lock"* ]]; then
    echo "WARNING: Cargo.lock pins v8 $v8_lock but the cached artifacts are in $v8_dir" >&2
    echo "         download the matching rusty-v8-v$v8_lock assets first (see HCODEX.md)" >&2
  fi

  # Back up what is installed now so --rollback can restore it after a bad build.
  if [[ -x "$BIN_DIR/hcodex" ]]; then
    mkdir -p "$BACKUP_DIR"
    cp -fL "$BIN_DIR/hcodex" "$BACKUP_DIR/hcodex"
    [[ -x "$BIN_DIR/codex-code-mode-host" ]] && cp -fL "$BIN_DIR/codex-code-mode-host" "$BACKUP_DIR/codex-code-mode-host"
    echo "backed up installed binaries to $BACKUP_DIR"
  fi

  if [[ "${SKIP_TESTS:-}" != "1" ]]; then
    say "test gate (harness unit tests)"
    cargo test -q -p codex-model-provider -p codex-model-provider-info 2>&1 | tail -5
    cargo test -q -p codex-tui -- provider_setup command_popup 2>&1 | tail -5
  fi

  say "release build"
  cargo build --release --bin hcodex --bin codex-code-mode-host

  say "smoke test (built binary, not yet installed)"
  "$ROOT/scripts/harness-smoke.sh" "$PWD/target/release/hcodex"

  say "install"
  ln -sf "$PWD/target/release/hcodex" "$BIN_DIR/hcodex"
  ln -sf "$PWD/target/release/codex-code-mode-host" "$BIN_DIR/codex-code-mode-host"
  rm -f "$HCODEX_HOME/models_cache.json"
  echo "installed: $("$BIN_DIR/hcodex" --version)"
  echo "reminder: codex-ide types -> cd ~/github/codex-ide && hcodex app-server generate-ts --out src/protocol && pnpm exec tsc --noEmit"
}

case "$MODE" in
  --build-only) build_gate_install ;;
  --no-build|--dry-run) git_sync ;;
  "") git_sync; build_gate_install ;;
  *) echo "unknown option: $MODE" >&2; exit 2 ;;
esac
