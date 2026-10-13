#!/usr/bin/env bash
set -euo pipefail

CODEX_ROOT="${CODEX_HOME:-$HOME/.codex}"
TARGET="$CODEX_ROOT/skills"
APPLY=0
EXACT=0

usage() {
  cat <<'EOF'
Usage: scripts/rollback.sh <backup-directory> [--apply] [--exact] [--target <skills-directory>]

Dry-runs by default. Standard rollback restores replaced skills and preserves
skills that were newly installed. --exact also removes those newly installed
skills. The .system directory is never modified.
EOF
}

[[ $# -gt 0 ]] || { usage >&2; exit 2; }
BACKUP="$1"
shift
while (($#)); do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --exact) EXACT=1; shift ;;
    --target) TARGET="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

STATE="$BACKUP/state.tsv"
[[ -f "$STATE" ]] || { echo "Invalid backup: missing $STATE" >&2; exit 1; }

while IFS=$'\t' read -r name state; do
  [[ -n "$name" && "$name" != ".system" ]] || continue
  case "$state" in
    existing) echo "RESTORE $name" ;;
    missing)
      if ((EXACT)); then echo "REMOVE  $name"; else echo "KEEP    $name (new after backup)"; fi
      ;;
    *) echo "Invalid backup state for $name: $state" >&2; exit 1 ;;
  esac
done < "$STATE"

if ((APPLY == 0)); then
  echo "Dry-run only. Re-run with --apply to roll back."
  exit 0
fi

mkdir -p "$TARGET"
while IFS=$'\t' read -r name state; do
  [[ -n "$name" && "$name" != ".system" ]] || continue
  destination="$TARGET/$name"
  if [[ "$state" == "existing" ]]; then
    source="$BACKUP/skills/$name"
    [[ -d "$source" ]] || { echo "Backup payload missing: $source" >&2; exit 1; }
    temporary="$TARGET/.open-skills-rollback-$name-$$"
    rm -rf "$temporary"
    cp -R "$source" "$temporary"
    rm -rf "$destination"
    mv "$temporary" "$destination"
  elif ((EXACT)); then
    rm -rf "$destination"
  fi
done < "$STATE"

echo "Rollback complete from $BACKUP"
