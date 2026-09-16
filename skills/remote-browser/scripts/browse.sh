#!/usr/bin/env bash
# Open a URL in the logged-in Chrome on remote-browser and dump readable text / HTML.
# For pages plain fetching cannot reach: Cloudflare walls, login walls, JS
# shells, click-to-reveal phones on VN classifieds, Facebook/marketplace pages.
#
#   browse.sh https://example.com                  # readable text (4000 chars)
#   browse.sh https://example.com --html           # raw HTML
#   browse.sh https://example.com --chars 12000
#   browse.sh https://example.com --shot /tmp/p.png   # PNG stays on remote-browser; path is printed
set -uo pipefail

REMOTE=remote-browser
HELPER_LOCAL="$(dirname "$0")/_remote_browse.py"
URL=""; MODE="text"; CHARS=4000; SHOT="-"; WAIT=120; SETTLE=6000
while [ $# -gt 0 ]; do
  case "$1" in
    --html)   MODE="html"; shift;;
    --chars)  CHARS="$2"; shift 2;;
    --shot)   SHOT="$2"; shift 2;;
    --wait)   WAIT="$2"; shift 2;;
    --settle) SETTLE="$2"; shift 2;;
    -h|--help) sed -n '2,10p' "$0"; exit 0;;
    *) URL="$1"; shift;;
  esac
done
[ -n "$URL" ] || { echo "usage: browse.sh <url> [--html] [--chars N] [--shot FILE]" >&2; exit 2; }

REMOTE_PY="/tmp/scout-$$.py"
scp -q "$HELPER_LOCAL" "$REMOTE:$REMOTE_PY" || { echo "scp to $REMOTE failed" >&2; exit 1; }

# Detached + polled: a foreground ssh call is killed while the page is still
# loading, leaving an orphan tab in the shared browser.
OUT="/tmp/scout-$$.out"; ERR="/tmp/scout-$$.err"
# Shared single-tenant Chrome: serialise with the same lock marketplace-search
# uses, otherwise concurrent jobs swap tabs and return each other's page.
ssh -n -o ConnectTimeout=10 "$REMOTE" \
  "nohup flock -w 300 /tmp/fb-browser.lock python3 $REMOTE_PY '$URL' '$MODE' '$CHARS' '$SHOT' '$SETTLE' >$OUT 2>$ERR & echo ok" >/dev/null \
  || { echo "cannot start remote job" >&2; exit 1; }

# Poll only the process state — never the payload, or a large HTML dump gets
# re-transferred on every tick and the whole call appears to hang.
for _ in $(seq 1 "$((WAIT / 5))"); do
  sleep 5
  STATE=$(ssh -n -o ConnectTimeout=10 "$REMOTE" \
    "pgrep -f '$REMOTE_PY' >/dev/null && echo RUNNING || echo DONE" 2>/dev/null)
  [ "$STATE" = "DONE" ] && break
done

BODY=$(ssh -n -o ConnectTimeout=10 "$REMOTE" "head -c $((CHARS * 4)) $OUT" 2>/dev/null)
DIAG=$(ssh -n "$REMOTE" "cat $ERR; rm -f $REMOTE_PY $OUT $ERR" 2>/dev/null)
if [ -z "${BODY//[[:space:]]/}" ]; then
  echo "FAILED: no content after ${WAIT}s" >&2
  printf '%s\n' "$DIAG" | head -c 500 >&2
  echo "hint: check the browser with ~/.pi/agent/skills/marketplace-search/scripts/fb-search.sh --health" >&2
  exit 1
fi
printf '%s\n' "$DIAG" | grep -E '^# (url|title|screenshot)=' >&2 || true
printf '%s\n' "$BODY"
