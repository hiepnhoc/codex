#!/bin/sh
# Install or update hcodex (macOS) from the GitHub Releases of hiepnhoc/codex.
#
#   curl -fsSL https://github.com/hiepnhoc/codex/releases/latest/download/install.sh | sh
#
#   HCODEX_RELEASE=0.1.0 ...   install a specific version instead of latest
#   HCODEX_INSTALL_DIR=...     where the binaries go (default ~/.hcodex/bin)
#
# Binaries land in ~/.hcodex/bin (same place scripts/sync-upstream.sh installs
# to) and a symlink is put in ~/.cargo/bin or ~/.local/bin so `hcodex` is on
# PATH. The previous binaries are kept in ~/.hcodex/backup.
set -eu

REPO="hiepnhoc/codex"
RELEASE="${HCODEX_RELEASE:-latest}"
HCODEX_HOME="${HOME}/.hcodex"
INSTALL_DIR="${HCODEX_INSTALL_DIR:-$HCODEX_HOME/bin}"
BACKUP_DIR="$HCODEX_HOME/backup"
BINARIES="hcodex codex-code-mode-host"

step() { printf '==> %s\n' "$1"; }
fail() { printf 'ERROR: %s\n' "$1" >&2; exit 1; }

os="$(uname -s)"
arch="$(uname -m)"
case "$os:$arch" in
  Darwin:arm64) target="aarch64-apple-darwin" ;;
  Darwin:x86_64) fail "no hcodex build for Intel macOS yet (only Apple Silicon); build from source, see HCODEX.md" ;;
  Linux:*) fail "this installer is for macOS; on Windows use install.ps1, on Linux/WSL build from source (HCODEX.md)" ;;
  *) fail "unsupported platform $os/$arch" ;;
esac

asset="hcodex-${target}.tar.gz"
case "$RELEASE" in
  latest) base="https://github.com/${REPO}/releases/latest/download" ;;
  hcodex-v*) base="https://github.com/${REPO}/releases/download/${RELEASE}" ;;
  *) base="https://github.com/${REPO}/releases/download/hcodex-v${RELEASE#v}" ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is required"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

step "download $base/$asset"
curl -fsSL --retry 3 -o "$tmp/$asset" "$base/$asset" || fail "download failed (no release yet, or no asset for $target?)"
curl -fsSL --retry 3 -o "$tmp/$asset.sha256" "$base/$asset.sha256" || fail "checksum download failed"

step "verify checksum"
expected="$(cut -d' ' -f1 < "$tmp/$asset.sha256")"
actual="$(shasum -a 256 "$tmp/$asset" | cut -d' ' -f1)"
[ "$expected" = "$actual" ] || fail "sha256 mismatch: expected $expected got $actual"

step "extract"
mkdir -p "$tmp/x"
tar -xzf "$tmp/$asset" -C "$tmp/x"
for b in $BINARIES; do
  [ -f "$tmp/x/$b" ] || fail "archive is missing $b"
  chmod +x "$tmp/x/$b"
  # curl does not set the quarantine flag, but clear it in case the archive was fetched by a browser.
  xattr -d com.apple.quarantine "$tmp/x/$b" 2>/dev/null || true
done
new_version="$("$tmp/x/hcodex" --version 2>/dev/null || true)"
[ -n "$new_version" ] || fail "downloaded hcodex does not run"

mkdir -p "$INSTALL_DIR"
if [ -x "$INSTALL_DIR/hcodex" ]; then
  old_version="$("$INSTALL_DIR/hcodex" --version 2>/dev/null || echo unknown)"
  step "backup current ($old_version) -> $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"
  for b in $BINARIES; do
    [ -f "$INSTALL_DIR/$b" ] && cp -f "$INSTALL_DIR/$b" "$BACKUP_DIR/$b"
  done
fi

step "install -> $INSTALL_DIR"
for b in $BINARIES; do
  # mv over the running binary is fine on macOS: the old inode stays alive until exit.
  mv -f "$tmp/x/$b" "$INSTALL_DIR/$b.new"
  mv -f "$INSTALL_DIR/$b.new" "$INSTALL_DIR/$b"
done
# Models are re-listed from the provider on next start.
rm -f "$HCODEX_HOME"/models_cache*.json 2>/dev/null || true

# Put hcodex on PATH: prefer ~/.cargo/bin (the sync script's convention), else ~/.local/bin.
if [ -d "$HOME/.cargo/bin" ]; then
  link_dir="$HOME/.cargo/bin"
else
  link_dir="$HOME/.local/bin"
  mkdir -p "$link_dir"
fi
for b in $BINARIES; do
  ln -sf "$INSTALL_DIR/$b" "$link_dir/$b"
done
case ":$PATH:" in
  *":$link_dir:"*) ;;
  *)
    printf 'NOTE: %s is not on PATH. Add to ~/.zshrc:\n  export PATH="%s:$PATH"\n' "$link_dir" "$link_dir"
    ;;
esac

step "installed $new_version"
printf '    %s/hcodex (symlink %s/hcodex)\n' "$INSTALL_DIR" "$link_dir"
