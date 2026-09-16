#!/usr/bin/env bash
# Live Telegram search wrapper.
#
#   tg-search.sh "кроссовки"                       # research account, 20 hits
#   tg-search.sh "кроссовки" --limit 40 --dialogs 300
#   tg-search.sh "аренда" --account default        # personal account
#   tg-search.sh --batch '[{"query":"a"},{"query":"b"}]'
#   tg-search.sh --dialogs-list                    # what chats are joined
#   tg-search.sh "nails" --raw                     # full JSON instead of table
set -uo pipefail

NAKED="$HOME/work/tg_agent/naked"
PY="$NAKED/.venv/bin/python"
TR="$NAKED/skills/telegram-reader/scripts/telegram_reader.py"

[ -x "$PY" ] || { echo "no venv at $PY — see $NAKED/skills/RUNBOOK-local.md" >&2; exit 2; }
[ -f "$HOME/work/tg_agent/.env" ] || { echo "missing ~/work/tg_agent/.env (the only path the reader loads)" >&2; exit 2; }

QUERY=""; ACCOUNT="research"; LIMIT=20; DIALOGS=200; RAW=0; BATCH=""; MODE="search"
CHANNEL=""; DATE_FROM=""; DATE_TO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --account) ACCOUNT="$2"; shift 2;;
    --limit) LIMIT="$2"; shift 2;;
    --dialogs|--dialogs-limit) DIALOGS="$2"; shift 2;;
    --channel|--channel-filter) CHANNEL="$2"; shift 2;;
    --since|--date-from) DATE_FROM="$2"; shift 2;;
    --until|--date-to) DATE_TO="$2"; shift 2;;
    --batch) BATCH="$2"; MODE="batch"; shift 2;;
    --dialogs-list) MODE="dialogs"; shift;;
    --raw) RAW=1; shift;;
    -h|--help) sed -n '2,10p' "$0"; exit 0;;
    *) QUERY="$1"; shift;;
  esac
done

# A stale process keeps the fcntl lock and every later call reports "session is busy".
pgrep -f "telegram_reader.py" >/dev/null 2>&1 && { pkill -f "telegram_reader.py"; sleep 2; }

case "$MODE" in
  dialogs) ARGS=(list_dialogs --limit "$LIMIT");;
  batch)   ARGS=(batch --batch-json "$BATCH");;
  search)
    [ -n "$QUERY" ] || { echo "usage: tg-search.sh \"query\" [--limit N] [--dialogs N] [--account research|default]" >&2; exit 2; }
    ARGS=(search_global --query "$QUERY" --limit "$LIMIT" --dialogs-limit "$DIALOGS")
    [ -n "$CHANNEL" ]   && ARGS+=(--channel-filter "$CHANNEL")
    [ -n "$DATE_FROM" ] && ARGS+=(--date-from "$DATE_FROM")
    [ -n "$DATE_TO" ]   && ARGS+=(--date-to "$DATE_TO");;
esac

OUT=$("$PY" "$TR" --account "$ACCOUNT" "${ARGS[@]}" 2>/tmp/tg-search.err); RC=$?
if [ $RC -ne 0 ] || [ -z "$OUT" ]; then
  echo "FAILED rc=$RC stderr: $(head -c 400 /tmp/tg-search.err)" >&2
  grep -q "AuthKeyNotFound" /tmp/tg-search.err 2>/dev/null && \
    echo "hint: session dead -> re-auth, see skills/telegram-reader/README.md §5" >&2
  exit 1
fi

if [ "$RAW" = 1 ]; then printf '%s\n' "$OUT"; exit 0; fi

printf '%s' "$OUT" | "$PY" "$(dirname "$0")/_format.py"
