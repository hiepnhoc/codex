#!/usr/bin/env bash
# hcodex: find sessions by content (what /resume cannot do — its search only
# matches the thread name and the first user message).
#
#   scripts/hc-find-session.sh <keyword> [days=30]
#
# Prints: date  cwd  thread-id  first user message, newest first. Resume with:
#   hcodex resume <thread-id>
set -euo pipefail
kw="${1:?usage: hc-find-session.sh <keyword> [days]}"; days="${2:-30}"
root="${CODEX_HOME:-$HOME/.hcodex}/sessions"
find "$root" -name 'rollout-*.jsonl' -mtime -"$days" -print0 2>/dev/null \
  | xargs -0 grep -li -- "$kw" 2>/dev/null | sort -ru | while read -r f; do
  python3 - "$f" <<'PY'
import json,sys,os
f=sys.argv[1]; cwd=None; sid=None; first=None; ts=None
with open(f) as fh:
    for line in fh:
        try: o=json.loads(line)
        except Exception: continue
        p=o.get("payload",{})
        if o.get("type")=="session_meta":
            cwd=p.get("cwd"); sid=p.get("id"); ts=(o.get("timestamp") or p.get("timestamp") or "")[:16]
        elif o.get("type")=="response_item" and p.get("type")=="message" and p.get("role")=="user" and first is None:
            t=" ".join(c.get("text","") for c in p.get("content",[]) if isinstance(c,dict))
            t=t.strip()
            if t and not t.startswith("<") and not t.startswith("# AGENTS.md") and "<INSTRUCTIONS>" not in t:
                first=t.replace("\n"," ")[:90]
        if cwd and sid and first: break
print(f"{ts}  {os.path.relpath(cwd or '?', os.path.expanduser('~'))}  {sid}  {first or ''}")
PY
done
