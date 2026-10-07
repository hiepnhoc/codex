#!/usr/bin/env bash
set -euo pipefail

VERSION="1.7.17"
RELEASE_BASE="https://github.com/alibaba/open-code-review/releases/download/v${VERSION}"
TARGET="${OCR_INSTALL_TARGET:-$HOME/.local/bin/ocr}"
APPLY=0

usage() {
  cat <<'USAGE'
Install the pinned Open Code Review native binary for the local user.

Usage:
  install-ocr.sh [--apply]

Default is dry-run. --apply downloads the exact pinned release, verifies its
embedded SHA-256, verifies `ocr version`, backs up an existing target, and
atomically installs the binary. No npm lifecycle scripts or auto-updater are used.

Environment:
  OCR_INSTALL_TARGET   Override target path. Default: ~/.local/bin/ocr
USAGE
}

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; usage; exit 2 ;;
  esac
done

os="$(uname -s)"
arch="$(uname -m)"
case "$os/$arch" in
  Darwin/arm64)
    asset="opencodereview-darwin-arm64"
    expected="d1771b962ae518bd0e75093b695633e1d12f80700521f5eb5872651b83595012"
    ;;
  Darwin/x86_64)
    asset="opencodereview-darwin-amd64"
    expected="b5e529b3a617c00f55e44a1da1731891833e051a442be55f67e47c8487a901e2"
    ;;
  Linux/aarch64|Linux/arm64)
    asset="opencodereview-linux-arm64"
    expected="1f9b0d12dec307e136a3fe28611be29058303d403d03b210d25aa0aa59a61f98"
    ;;
  Linux/x86_64|Linux/amd64)
    asset="opencodereview-linux-amd64"
    expected="ab2fae81796a00dda292def8261bec2203d03f3909673c08219e7c5df5f4feee"
    ;;
  *) echo "Unsupported platform: $os/$arch" >&2; exit 1 ;;
esac

url="$RELEASE_BASE/$asset"
cat <<INFO
Open Code Review pinned installer
Version: v$VERSION
Asset:   $asset
URL:     $url
SHA-256: $expected
Target:  $TARGET
Mode:    $([[ "$APPLY" == "1" ]] && echo apply || echo dry-run)
INFO

if [[ "$APPLY" != "1" ]]; then
  echo "Dry run only. Re-run with --apply to install."
  exit 0
fi

for command in curl shasum mktemp install; do
  command -v "$command" >/dev/null || { echo "Required command not found: $command" >&2; exit 1; }
done

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/higa-ocr-install.XXXXXX")"
chmod 700 "$tmpdir"
trap 'rm -rf "$tmpdir"' EXIT

tmpbin="$tmpdir/ocr"
curl --fail --silent --show-error --location "$url" --output "$tmpbin"
actual="$(shasum -a 256 "$tmpbin" | awk '{print $1}')"
if [[ "$actual" != "$expected" ]]; then
  echo "Checksum mismatch for $asset" >&2
  echo "Expected: $expected" >&2
  echo "Actual:   $actual" >&2
  exit 1
fi
chmod 755 "$tmpbin"

version_output="$(HOME="$tmpdir/home" OCR_NO_UPDATE=1 "$tmpbin" version)"
case "$version_output" in
  *"open-code-review v$VERSION"*) ;;
  *) printf 'Unexpected OCR version output:\n%s\n' "$version_output" >&2; exit 1 ;;
esac

mkdir -p "$(dirname "$TARGET")"
if [[ -e "$TARGET" ]]; then
  backup="${TARGET}.backup-$(date +%Y%m%d-%H%M%S)"
  cp -p "$TARGET" "$backup"
  echo "Backup created: $backup"
fi

staged="${TARGET}.new.$$"
install -m 0755 "$tmpbin" "$staged"
mv -f "$staged" "$TARGET"

installed="$($TARGET version)"
case "$installed" in
  *"open-code-review v$VERSION"*) ;;
  *) echo "Installed binary failed version verification" >&2; exit 1 ;;
esac

printf '%s\n' "$installed"
echo "Installed pinned OCR binary to $TARGET"
case ":$PATH:" in
  *":$(dirname "$TARGET"):"*) ;;
  *) echo "Note: add $(dirname "$TARGET") to PATH before starting OpenCode." ;;
esac
