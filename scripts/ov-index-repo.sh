#!/usr/bin/env bash
# Index (or refresh) a git repo into OpenViking so hcodex can recall it instead of
# re-scanning. Uses `git archive` (tracked files only -> no node_modules) and sane
# excludes; the resource name defaults to the repo directory name.
#
# Usage: scripts/ov-index-repo.sh [/path/to/repo] [name] [--wait]
set -euo pipefail
export PATH="$HOME/.local/bin:$PATH"
REPO="$(cd "${1:-.}" && pwd)"
NAME="${2:-$(basename "$REPO")}"
WAIT=""; [[ "${3:-}" == "--wait" || "${2:-}" == "--wait" ]] && WAIT="--wait"
[[ "${2:-}" == "--wait" ]] && NAME="$(basename "$REPO")"
git -C "$REPO" rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "not a git repo: $REPO" >&2; exit 1; }
ZIP="$(mktemp -t ov-index).zip"
git -C "$REPO" archive --format=zip -o "$ZIP" HEAD
echo "archive: $(du -h "$ZIP" | cut -f1)  ->  viking://~/resources/$NAME"
ov add-resource "$ZIP" --to "viking://~/resources/$NAME" $WAIT \
  --ignore-dirs "node_modules,dist,build,server-build,.idea,.cache,.next,target,coverage,vendor,lib,public,__pycache__,.venv" \
  --exclude "*.lock,package-lock.json,yarn.lock,pnpm-lock.yaml,*.min.js,*.map,*.png,*.jpg,*.jpeg,*.gif,*.svg,*.ico,*.woff,*.woff2,*.ttf,*.pdf,*.zip,*.jar,*.class,*.wasm,*.data,*.bin" \
  -o json | python3 -c "import sys,json; d=json.load(sys.stdin); r=d.get('result',{}); print('task:', r.get('task_id'), '| status:', r.get('status'), '| uri:', r.get('root_uri'))"
rm -f "$ZIP"
echo "progress: ov status   |   tree: ov tree viking://~/resources/$NAME -L 1   |   search: ov find \"...\""
