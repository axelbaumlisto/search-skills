#!/bin/bash
# homepro-th: hp.sh "<запрос>" [--no-cache]
set -u
S="$(cd "$(dirname "$0")" && pwd)"; SHARED="$S/../../_thai_shared"
. "$SHARED/cache.sh"
Q="${1:-}"; [ "${2:-}" = "--no-cache" ] && THAI_NO_CACHE=1
[ -z "$Q" ] && { echo 'usage: hp.sh "<query>" [--no-cache]'; exit 2; }
python3 "$SHARED/hp.py" "$Q"
