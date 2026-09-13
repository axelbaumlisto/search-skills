#!/usr/bin/env bash
# Facebook Marketplace search, geo-scoped, with price filters.
#
# One HTTPS request: replays Facebook's own Marketplace GraphQL query with cookies
# exported from your local Chrome. No browser, no ssh.
#
#   fb-search.sh "sneakers" danang
#   fb-search.sh "giay 45" hcmc --limit 20 --min 300000 --max 3000000
#   fb-search.sh "google pixel" --lat 9.5120 --lng 100.0136 --radius 25
#   fb-search.sh "iphone" danang --days 7 --shipping
#   fb-search.sh "macbook" bangkok --raw       # JSON instead of the table
#   fb-search.sh --health                      # session alive? budget left?
#
# Exit: 0 ok · 2 usage · 3 session/template problem · 4 Facebook flagged the account (STOP)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../../shared/common.sh"

COOKIES="$(expand_tilde "${FB_COOKIES:-$CONF_DIR/facebook.cookies.txt}")"
LOCAL="$HERE/fb_local.py"
CITIES="$(FB_DIR="$HERE" "$PY" -c 'import os,sys; sys.path.insert(0, os.environ["FB_DIR"]); import fb_graphql; print(" ".join(sorted(fb_graphql.CITY_COORDS)))')"

QUERY=""; CITY=""; LIMIT=10; MODE="search"; RAW=0
LAT=""; LNG=""; RADIUS=""; MINP=""; MAXP=""; DAYS=""; SHIPPING=0
while [ $# -gt 0 ]; do
  case "$1" in
    --health)   MODE="health"; shift;;
    --limit)    LIMIT="$2"; shift 2;;
    --lat)      LAT="$2"; shift 2;;
    --lng)      LNG="$2"; shift 2;;
    --radius)   RADIUS="$2"; shift 2;;
    --min)      MINP="$2"; shift 2;;
    --max)      MAXP="$2"; shift 2;;
    --days)     DAYS="$2"; shift 2;;
    --shipping) SHIPPING=1; shift;;
    --raw)      RAW=1; shift;;
    -h|--help)  show_help "$0"; exit 0;;
    *) if [ -z "$QUERY" ]; then QUERY="$1"; elif [ -z "$CITY" ]; then CITY="$1"; fi; shift;;
  esac
done

[ "$MODE" = "health" ] && exec "$HERE/fb-cookies.sh"

[ -n "$QUERY" ] || { echo "usage: fb-search.sh \"query\" <city>  (cities: $CITIES)" >&2; exit 2; }
if [ -n "$CITY" ] && ! printf '%s' "$CITIES" | tr ' ' '\n' | grep -qx "$CITY"; then
  echo "unknown city '$CITY'. known: $CITIES" >&2; exit 2
fi
if [ -z "$CITY" ] && [ -z "$LAT" ]; then
  echo "warn: no city and no --lat/--lng -> results follow the account location (geo_verified=false)" >&2
fi

# The query comes from an LLM reading untrusted marketplace text: pass it as an argv
# array, never as a shell string.
ARGS=("$QUERY"); [ -n "$CITY" ] && ARGS+=("$CITY")
ARGS+=(--limit "$LIMIT")
[ -n "$LAT" ]  && ARGS+=(--lat "$LAT" --lng "$LNG" --radius-km "${RADIUS:-25}")
[ -n "$MINP" ] && ARGS+=(--min-price "$MINP")
[ -n "$MAXP" ] && ARGS+=(--max-price "$MAXP")
[ -n "$DAYS" ] && ARGS+=(--days "$DAYS")
[ "$SHIPPING" = 1 ] && ARGS+=(--shipping)

[ -f "$COOKIES" ] || { echo "no cookie store at $COOKIES — run: $HERE/fb-cookies.sh refresh" >&2; exit 3; }

OUT=$(FB_COOKIES="$COOKIES" "$PY" "$LOCAL" "${ARGS[@]}"); RC=$?
if [ $RC -ne 0 ] || [ -z "$OUT" ]; then
  [ -n "$OUT" ] && printf '%s\n' "$OUT" >&2
  [ $RC -eq 4 ] && { echo "STOP: Facebook flagged this session. Do not retry." >&2; exit 4; }
  echo "hint: $HERE/fb-cookies.sh   (session alive? template captured?)" >&2
  exit ${RC:-3}
fi

if [ "$RAW" = 1 ]; then printf '%s\n' "$OUT"; else printf '%s' "$OUT" | "$PY" "$HERE/_format.py"; fi
