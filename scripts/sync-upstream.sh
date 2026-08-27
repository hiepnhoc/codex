#!/usr/bin/env bash
# Sync the hcodex harness with openai/codex:
#   main        <- fast-forward to upstream/main (never commit here)
#   my-harness  <- rebased on top of main
# then rebuild and reinstall the release binaries.
#
# Usage: scripts/sync-upstream.sh [--no-build]
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
BRANCH="${HARNESS_BRANCH:-my-harness}"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "working tree not clean — commit or stash first" >&2
  exit 1
fi

git remote get-url upstream >/dev/null 2>&1 || git remote add upstream https://github.com/openai/codex.git

echo "==> fetch upstream"
git fetch upstream --prune

echo "==> update main"
git checkout -q main
git merge --ff-only upstream/main
git push -q origin main 2>/dev/null || echo "(skip push main to origin)"

echo "==> rebase $BRANCH onto main"
git checkout -q "$BRANCH"
if ! git rebase main; then
  cat >&2 <<'MSG'

Rebase conflict. Resolve in the files listed above, then:
  git add <files> && git rebase --continue
or abort with:  git rebase --abort
Harness changes are small (see HCODEX.md "Khác gì so với codex gốc") — usually
only those files conflict.
MSG
  exit 1
fi

echo "==> harness commits on top of main:"
git log --oneline main.."$BRANCH" | cat

if [[ "${1:-}" == "--no-build" ]]; then
  exit 0
fi

echo "==> rebuild release"
cd codex-rs
V8_DIR="$HOME/.cargo/.rusty_v8/codex-v150.4.0"
if [[ -d "$V8_DIR" ]]; then
  export RUSTY_V8_ARCHIVE="$V8_DIR/librusty_v8_ptrcomp_sandbox_release_aarch64-apple-darwin.a.gz"
  export RUSTY_V8_SRC_BINDING_PATH="$V8_DIR/src_binding_ptrcomp_sandbox_release_aarch64-apple-darwin.rs"
fi
cargo build --release --bin hcodex --bin codex-code-mode-host
ln -sf "$PWD/target/release/hcodex" "$HOME/.cargo/bin/hcodex"
ln -sf "$PWD/target/release/codex-code-mode-host" "$HOME/.cargo/bin/codex-code-mode-host"
rm -f "$HOME/.hcodex/models_cache.json"
echo "==> done: $(hcodex --version)"
