#!/usr/bin/env bash
# Run the hcodex harness tests (scripts/harness-tests/): what the harness adds on top of
# upstream codex, checked from the outside against a stand-in provider. No network, no real
# provider, no build; never touches ~/.hcodex or ~/.codex.
#
# Usage: scripts/harness-test.sh [path/to/hcodex] [options]
#   (no binary)   test `hcodex` on PATH
#   --live        also check this machine's real ~/.hcodex (config, roles, credentials, skills)
#   -k TEXT       only tests whose id or name contains TEXT, e.g. -k RT -k AS21
#   --list        list every test case
#   --jobs N      test files run at the same time (default 4)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -gt 0 && "$1" != -* ]]; then
  HCODEX_BIN="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; export HCODEX_BIN; shift
fi
exec python3 "$HERE/harness-tests/run.py" "$@"
