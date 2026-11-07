#!/usr/bin/env bash
# Google Places (New) wrapper.
#
#   places.sh "sneaker store Da Nang"                     # text search, 5 results
#   places.sh "cafe" --near 16.0545,108.2022 --radius 3000 --limit 10
#   places.sh "shoe store" --type shoe_store --lang vi
#   places.sh --details ChIJ5RyeqbgZQjERlsBq0A9QNzo       # hours, phone, website
#   places.sh --budget                                    # quota counter
#   places.sh "..." --raw                                 # raw JSON
set -uo pipefail

# Explicit overrides win. Otherwise discover a compatible checkout without
# embedding a private repository or username in this public skill.
PLACES_HOME="${PLACES_HOME:-}"
if [ -z "$PLACES_HOME" ]; then
  for cand in "$HOME"/work/*/* "$HOME/.config/google-places"; do
    if [ -x "$cand/.venv/bin/python" ] && [ -f "$cand/skills/gmaps-places/scripts/gmaps_cli.py" ]; then
      PLACES_HOME="$cand"; break
    fi
  done
fi
PY="${PYTHON_BIN:-${PLACES_HOME:-}/.venv/bin/python}"
CLI="${PLACES_CLI:-${PLACES_HOME:-}/skills/gmaps-places/scripts/gmaps_cli.py}"
ENV_FILE="${PLACES_ENV:-${PLACES_HOME:+$(dirname "$PLACES_HOME")/.env}}"

[ -x "$PY" ] && [ -f "$CLI" ] || { echo "Places runtime not found; set PLACES_HOME or PLACES_CLI/PYTHON_BIN" >&2; exit 2; }
[ -n "$ENV_FILE" ] && [ -f "$ENV_FILE" ] || { echo "Places env not found; set PLACES_ENV (GOOGLE_API_KEY lives there)" >&2; exit 2; }
KEY_LINE=$(grep -E '^GOOGLE_API_KEY=' "$ENV_FILE" | head -1)
[ -n "$KEY_LINE" ] || { echo "GOOGLE_API_KEY not found in $ENV_FILE" >&2; exit 2; }
export "${KEY_LINE?}"

QUERY=""; MODE="search"; LIMIT=5; RAW=0; EXTRA=()
while [ $# -gt 0 ]; do
  case "$1" in
    --details) MODE="details"; QUERY="$2"; shift 2;;
    --budget)  MODE="budget"; shift;;
    --limit)   LIMIT="$2"; shift 2;;
    --near)    EXTRA+=(--near "$2"); shift 2;;
    --radius)  EXTRA+=(--radius "$2"); shift 2;;
    --type)    EXTRA+=(--type "$2"); shift 2;;
    --lang)    EXTRA+=(--lang "$2"); shift 2;;
    --raw)     RAW=1; shift;;
    -h|--help) sed -n '2,9p' "$0"; exit 0;;
    *)         QUERY="$1"; shift;;
  esac
done

case "$MODE" in
  budget)  ARGS=(budget);;
  details) [ -n "$QUERY" ] || { echo "--details needs a place_id" >&2; exit 2; }
           ARGS=(details "$QUERY");;
  search)  [ -n "$QUERY" ] || { echo 'usage: places.sh "query" [--near LAT,LNG] [--radius M] [--limit N]' >&2; exit 2; }
           ARGS=(search "$QUERY" --limit "$LIMIT" "${EXTRA[@]+"${EXTRA[@]}"}");;
esac

OUT=$("$PY" "$CLI" "${ARGS[@]}" 2>/tmp/places.err); RC=$?
if [ $RC -ne 0 ] || [ -z "$OUT" ]; then
  echo "FAILED rc=$RC stderr: $(head -c 400 /tmp/places.err)" >&2; exit 1
fi
if [ "$RAW" = 1 ]; then printf '%s\n' "$OUT"; exit 0; fi
printf '%s' "$OUT" | "$PY" "$(dirname "$0")/_format.py"
