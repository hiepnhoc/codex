#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Run only the least-privilege OCR commands used by the ocr-code-review skill.

Allowed:
  ocr-safe.sh version
  ocr-safe.sh delegate preview [flags]
  ocr-safe.sh delegate rule [flags] <paths...>

The helper uses an empty environment plus a temporary HOME so OCR cannot read
persistent provider credentials/config or retain session JSONL files.
USAGE
}

if [[ $# -lt 1 ]]; then usage >&2; exit 2; fi
case "$1" in
  version)
    [[ $# -eq 1 ]] || { echo "version accepts no additional arguments" >&2; exit 2; }
    ;;
  delegate)
    if [[ $# -lt 2 || ( "$2" != "preview" && "$2" != "rule" ) ]]; then
      echo "Only delegate preview and delegate rule are allowed" >&2
      exit 2
    fi
    ;;
  *) echo "Blocked OCR command: $1" >&2; usage >&2; exit 2 ;;
esac

OCR_BIN="${OCR_BIN:-}"
if [[ -z "$OCR_BIN" ]]; then OCR_BIN="$(command -v ocr 2>/dev/null || true)"; fi
if [[ -z "$OCR_BIN" && -x "$HOME/.local/bin/ocr" ]]; then OCR_BIN="$HOME/.local/bin/ocr"; fi
if [[ -z "$OCR_BIN" || ! -x "$OCR_BIN" ]]; then
  echo "Pinned OCR binary not found. Run scripts/install-ocr.sh --apply first." >&2
  exit 127
fi

safe_home="$(mktemp -d "${TMPDIR:-/tmp}/higa-ocr-home.XXXXXX")"
chmod 700 "$safe_home"
trap 'rm -rf "$safe_home"' EXIT INT TERM

safe_path="$(dirname "$OCR_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"
if [[ -d /opt/homebrew/bin ]]; then
  safe_path="$(dirname "$OCR_BIN"):/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
fi

env -i \
  HOME="$safe_home" \
  PATH="$safe_path" \
  TMPDIR="${TMPDIR:-/tmp}" \
  LANG="${LANG:-en_US.UTF-8}" \
  TERM="dumb" \
  OCR_NO_UPDATE="1" \
  "$OCR_BIN" "$@"
