#!/usr/bin/env bash
set -euo pipefail

PACK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CODEX_ROOT="${CODEX_HOME:-$HOME/.codex}"
TARGET="$CODEX_ROOT/skills"
APPLY=0

usage() {
  cat <<'EOF'
Usage: scripts/install.sh [--apply] [--target <skills-directory>]

Dry-runs by default. On apply, backs up and replaces only skill directories
listed in this pack. The target's .system directory and unrelated skills are
never modified.
EOF
}

while (($#)); do
  case "$1" in
    --apply) APPLY=1; shift ;;
    --target) TARGET="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

python3 "$PACK_ROOT/scripts/validate_pack.py"

mapfile_compat() {
  while IFS= read -r line; do SKILLS+=("$line"); done
}

SKILLS=()
mapfile_compat < <(find "$PACK_ROOT" -mindepth 2 -maxdepth 2 -name SKILL.md -print \
  | sed 's#/SKILL.md$##' | sort)

echo "Codex skill target: $TARGET"
for source in "${SKILLS[@]}"; do
  name="$(basename "$source")"
  destination="$TARGET/$name"
  if [[ ! -e "$destination" ]]; then
    state="ADD"
  elif diff -qr "$source" "$destination" >/dev/null 2>&1; then
    state="SAME"
  else
    state="UPDATE"
  fi
  printf '%-7s %s\n' "$state" "$name"
done

if ((APPLY == 0)); then
  echo "Dry-run only. Re-run with --apply to install."
  exit 0
fi

mkdir -p "$TARGET"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup="$CODEX_ROOT/backups/open-skills/$timestamp"
mkdir -p "$backup/skills"
: > "$backup/state.tsv"

for source in "${SKILLS[@]}"; do
  name="$(basename "$source")"
  destination="$TARGET/$name"
  if [[ -e "$destination" ]]; then
    printf '%s\texisting\n' "$name" >> "$backup/state.tsv"
    cp -R "$destination" "$backup/skills/$name"
  else
    printf '%s\tmissing\n' "$name" >> "$backup/state.tsv"
  fi
done

for source in "${SKILLS[@]}"; do
  name="$(basename "$source")"
  destination="$TARGET/$name"
  temporary="$TARGET/.open-skills-$name-$$"
  rm -rf "$temporary"
  cp -R "$source" "$temporary"
  rm -rf "$destination"
  mv "$temporary" "$destination"
done

cp "$PACK_ROOT/manifest.json" "$backup/installed-manifest.json"
echo "Installed ${#SKILLS[@]} skills. Backup: $backup"
