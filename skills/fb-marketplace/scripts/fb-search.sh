#!/usr/bin/env bash
# Facebook Marketplace search. Runs on remote-browser (host Chrome + CDP live there),
# detached + polled, because a foreground ssh call gets cut off mid-run.
#
#   fb-search.sh "sneakers" danang
#   fb-search.sh "giày 45" hcmc --limit 20 --min 300000 --max 3000000
#   fb-search.sh "google pixel" --lat 9.5120 --lng 100.0136 --radius 25
#   fb-search.sh --detail 1490722942332727
#   fb-search.sh --health              # is the browser alive and logged in?
set -uo pipefail

REMOTE=remote-browser
FB='naked/skills/facebook-marketplace/scripts/fb_marketplace.py'
TAG="fb-$$"
OUT="/tmp/$TAG.out"; ERR="/tmp/$TAG.err"
CITIES="bangkok pattaya phuket samui phangan chiangmai krabi danang hcmc hanoi nhatrang hoian"

QUERY=""; CITY=""; LIMIT=10; MODE="search"; WAIT=150; RAW=0
LAT=""; LNG=""; RADIUS=""; MINP=""; MAXP=""
while [ $# -gt 0 ]; do
  case "$1" in
    --detail)  MODE="detail"; QUERY="$2"; shift 2;;
    --health)  MODE="health"; shift;;
    --limit)   LIMIT="$2"; shift 2;;
    --lat)     LAT="$2"; shift 2;;
    --lng)     LNG="$2"; shift 2;;
    --radius)  RADIUS="$2"; shift 2;;
    --min)     MINP="$2"; shift 2;;
    --max)     MAXP="$2"; shift 2;;
    --wait)    WAIT="$2"; shift 2;;
    --raw)     RAW=1; shift;;
    -h|--help) sed -n '2,10p' "$0"; exit 0;;
    *) if [ -z "$QUERY" ]; then QUERY="$1"; elif [ -z "$CITY" ]; then CITY="$1"; fi; shift;;
  esac
done

if [ "$MODE" = "health" ]; then
  ssh -n -o ConnectTimeout=10 "$REMOTE" \
    'systemctl --user is-active chrome-cdp.service; curl -s -m 5 http://localhost:9222/json/version | head -3' \
    || { echo "cannot reach $REMOTE" >&2; exit 1; }
  echo "hint: if Facebook is logged out, sign in once via https://YOUR-HOST/vnc
  exit 0
fi

if [ "$MODE" = "search" ]; then
  [ -n "$QUERY" ] || { echo 'usage: fb-search.sh "query" <city>  (cities: '"$CITIES"')' >&2; exit 2; }
  if [ -z "$CITY" ] && [ -z "$LAT" ]; then
    echo "warn: no city and no --lat/--lng -> DOM backend, results follow the account location" >&2
  fi
  if [ -n "$CITY" ] && ! printf '%s' "$CITIES" | tr ' ' '\n' | grep -qx "$CITY"; then
    echo "unknown city '$CITY'. known: $CITIES" >&2; exit 2
  fi
  ARGS="search --query \"$QUERY\" --limit $LIMIT"
  [ -n "$CITY" ]   && ARGS="$ARGS --city $CITY --local-only"
  [ -n "$LAT" ]    && ARGS="$ARGS --lat $LAT --lng $LNG --radius-km ${RADIUS:-25} --local-only"
  [ -n "$MINP" ]   && ARGS="$ARGS --min-price $MINP"
  [ -n "$MAXP" ]   && ARGS="$ARGS --max-price $MAXP"
else
  [ -n "$QUERY" ] || { echo "--detail needs an item id" >&2; exit 2; }
  ARGS="detail --item-id $QUERY"
fi

# Fast path: replay the same GraphQL query over plain HTTP with the exported
# cookies (~5 s, no ssh, no shared browser tab). Only fall back to the remote
# browser when that fails (cookies expired, layout drift, detail mode).
LOCAL="$(dirname "$0")/fb_local.py"
if [ "$MODE" = "search" ] && [ -f "$LOCAL" ] && [ -z "$LAT" ]; then
  LARGS=("$QUERY"); [ -n "$CITY" ] && LARGS+=("$CITY")
  LARGS+=(--limit "$LIMIT")
  [ -n "$MINP" ] && LARGS+=(--min-price "$MINP")
  [ -n "$MAXP" ] && LARGS+=(--max-price "$MAXP")

  # Where to run the HTTP path is decided by WHOSE cookies are installed.
  # A Facebook session is bound to the machine/IP that created it, so the
  # requests must leave from that same place. Cookies exported from the local
  # Chrome (chrome_cookies.py) => run here; cookies dumped from the remote-browser
  # browser => run there. FB_LOCAL_SESSION=0 forces the remote path.
  LOCAL_SESSION="${FB_LOCAL_SESSION:-auto}"
  if [ "$LOCAL_SESSION" = "auto" ]; then
    if grep -q "exported from Chrome profile" \
         "$HOME/work/tg_agent/naked/.secrets/cookies/facebook.cookies.txt" 2>/dev/null; then
      LOCAL_SESSION=1
    else
      LOCAL_SESSION=0
    fi
  fi
  if [ "$LOCAL_SESSION" = "1" ]; then
    LOUT=$("$HOME/work/tg_agent/naked/.venv/bin/python" "$LOCAL" "${LARGS[@]}" 2>/dev/null)
  else
    scp -q "$LOCAL" "$REMOTE:/tmp/fb_local.py" 2>/dev/null
    QARGS=$(printf '%q ' "${LARGS[@]}")
    LOUT=$(ssh -n -o ConnectTimeout=10 "$REMOTE" \
      "cd ~/work/tg_agent && python3 /tmp/fb_local.py $QARGS" 2>/dev/null)
  fi

  if printf '%s' "$LOUT" | grep -q '"blocked"'; then
    printf '%s' "$LOUT" | python3 -c 'import json,sys; print("STOP:", json.load(sys.stdin)["error"])' >&2
    exit 4
  fi
  if [ -n "$LOUT" ] && ! printf '%s' "$LOUT" | grep -q '"error"'; then
    if [ "$RAW" = 1 ]; then printf '%s\n' "$LOUT"; else
      printf '%s' "$LOUT" | python3 "$(dirname "$0")/_format.py"; fi
    exit 0
  fi
  echo "HTTP path failed, falling back to the remote browser" >&2
fi

# Detach on the server: a plain `ssh ... python3` dies on timeout while the
# remote process keeps running and holding the browser.
# The remote Chrome is single-tenant: two concurrent jobs read each other's
# tab and silently return the wrong listing. Serialise every browser job
# (this script and browser-scout share /tmp/fb-browser.lock).
ssh -n -o ConnectTimeout=10 "$REMOTE" \
  "cd ~/work/tg_agent && nohup flock -w 300 /tmp/fb-browser.lock python3 $FB $ARGS >$OUT 2>$ERR & echo ok" >/dev/null \
  || { echo "cannot start remote job on $REMOTE" >&2; exit 1; }

for _ in $(seq 1 "$((WAIT / 5))"); do
  sleep 5
  STATE=$(ssh -n -o ConnectTimeout=10 "$REMOTE" \
    "pgrep -f 'fb_marketplace.py' >/dev/null && echo RUNNING || echo DONE; echo ---; cat $OUT" 2>/dev/null)
  BODY=${STATE#*---$'\n'}
  case "$STATE" in
    DONE*) break;;
  esac
  [ -n "${BODY//[[:space:]]/}" ] && break
done

if [ -z "${BODY:-}" ] || [ -z "${BODY//[[:space:]]/}" ]; then
  echo "FAILED: no JSON after ${WAIT}s. stderr:" >&2
  ssh -n "$REMOTE" "tail -c 400 $ERR" >&2
  ssh -n "$REMOTE" "pkill -f 'fb_marketplace.py'" 2>/dev/null
  echo "hint: check './fb-search.sh --health' and the VNC login" >&2
  exit 1
fi

ssh -n "$REMOTE" "rm -f $OUT $ERR" 2>/dev/null
if [ "$RAW" = 1 ]; then printf '%s\n' "$BODY"; exit 0; fi
printf '%s' "$BODY" | python3 "$(dirname "$0")/_format.py"
