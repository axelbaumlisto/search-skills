#!/bin/bash
# globalhouse-th: gh.sh "<запрос|category:ID>" [--branch GH-xxx] [--max-pages N] [--no-cache]
set -u
S="$(cd "$(dirname "$0")" && pwd)"; SHARED="$S/../../_thai_shared"; HOST="${THAI_MAT_HOST:-spex}"
. "$SHARED/cache.sh"
Q=""; BRANCH=""
while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --no-cache) THAI_NO_CACHE=1; shift ;;
    --max-pages) MAXP="${2:-}"; shift 2 ;;
    *) [ -z "$Q" ] && Q="$1"; shift ;;
  esac
done
[ -z "$Q" ] && { echo 'usage: gh.sh "<query|category:ID>" [--branch GH-xxx] [--no-cache]'; exit 2; }
scp -q "$SHARED/gh.py" "$SHARED/format.py" "$HOST:/tmp/" || exit 1
NEW=$(_thai_cached gh "$Q" "${BRANCH:-}" "ssh $HOST \"python3 /tmp/gh.py '$Q' ${BRANCH:+--branch $BRANCH}\"")
printf '%s' "$NEW" | python3 "$SHARED/format.py"
