#!/usr/bin/env bash
# Live Telegram search across the chats an account is already in.
#
#   tg-search.sh "кроссовки"                          # 20 hits, 200 dialogs scanned
#   tg-search.sh "giày 45" --limit 40 --dialogs 300
#   tg-search.sh "аренда" --channel danang            # only chats matching a name
#   tg-search.sh "iphone" --since 2026-09-01T00:00:00
#   tg-search.sh "плов" --account research            # a second, separate account
#   tg-search.sh --dialogs-list --limit 40            # what this account can see
#   tg-search.sh --in @somechat "стрим" --mine        # inside one chat, only my messages
#   tg-search.sh --context @somechat 106157 --before 20 --after 20
#   tg-search.sh --batch '[{"query":"a"},{"query":"b","limit":40}]'
#   tg-search.sh "nails" --raw                        # JSON instead of the table
#   tg-search.sh --login                              # authorize a new session
#
# Config: TG_API_ID / TG_API_HASH (my.telegram.org), optional TG_SESSION,
# TG_SESSION_DIR. Values may live in ~/.config/search-skills/.env.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PY="${PYTHON_BIN:-python3}"
READER="$HERE/tg_reader.py"

QUERY=""; ACCOUNT="default"; LIMIT=20; DIALOGS=200; RAW=0; BATCH=""; MODE="search"
CHANNEL=""; DATE_FROM=""; DATE_TO=""; CHAT=""; MINE=0; AROUND=""; BEFORE=10; AFTER=10
while [ $# -gt 0 ]; do
  case "$1" in
    --account) ACCOUNT="$2"; shift 2;;
    --limit) LIMIT="$2"; shift 2;;
    --dialogs|--dialogs-limit) DIALOGS="$2"; shift 2;;
    --channel|--channel-filter) CHANNEL="$2"; shift 2;;
    --since|--date-from) DATE_FROM="$2"; shift 2;;
    --until|--date-to) DATE_TO="$2"; shift 2;;
    --in) CHAT="$2"; MODE="chat"; shift 2;;
    --mine) MINE=1; shift;;
    --context) CHAT="$2"; AROUND="$3"; MODE="context"; shift 3;;
    --before) BEFORE="$2"; shift 2;;
    --after) AFTER="$2"; shift 2;;
    --batch) BATCH="$2"; MODE="batch"; shift 2;;
    --dialogs-list) MODE="dialogs"; shift;;
    --login) MODE="login"; shift;;
    --raw) RAW=1; shift;;
    -h|--help) sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) QUERY="$1"; shift;;
  esac
done

if [ "$MODE" = "login" ]; then
  exec "$PY" "$HERE/tg_login.py" --account "$ACCOUNT"
fi

# A killed-but-unreaped sibling keeps the session lock and every later call reports
# "session is busy" — clear it before starting.
pgrep -f "tg_reader.py" >/dev/null 2>&1 && { pkill -f "tg_reader.py"; sleep 2; }

case "$MODE" in
  dialogs) ARGS=(list_dialogs --limit "$LIMIT");;
  batch)   ARGS=(batch --batch-json "$BATCH" --limit "$LIMIT" --dialogs-limit "$DIALOGS");;
  context) ARGS=(context --chat "$CHAT" --around "$AROUND" --before "$BEFORE" --after "$AFTER");;
  chat)
    ARGS=(search_chat --chat "$CHAT" --limit "$LIMIT")
    [ -n "$QUERY" ] && ARGS+=(--query "$QUERY")
    [ "$MINE" = 1 ] && ARGS+=(--mine)
    [ -n "$DATE_FROM" ] && ARGS+=(--date-from "$DATE_FROM")
    [ -n "$DATE_TO" ] && ARGS+=(--date-to "$DATE_TO");;
  search)
    [ -n "$QUERY" ] || { echo 'usage: tg-search.sh "query" [--limit N] [--dialogs N] [--account NAME]' >&2; exit 2; }
    ARGS=(search_global --query "$QUERY" --limit "$LIMIT" --dialogs-limit "$DIALOGS")
    [ -n "$CHANNEL" ]   && ARGS+=(--channel-filter "$CHANNEL")
    [ -n "$DATE_FROM" ] && ARGS+=(--date-from "$DATE_FROM")
    [ -n "$DATE_TO" ]   && ARGS+=(--date-to "$DATE_TO");;
esac

ERRLOG="$(mktemp -t tg-search)"
OUT=$("$PY" "$READER" --account "$ACCOUNT" "${ARGS[@]}" 2>"$ERRLOG"); RC=$?
if [ $RC -ne 0 ] || [ -z "$OUT" ]; then
  echo "FAILED rc=$RC stderr: $(head -c 400 "$ERRLOG")" >&2
  grep -q "AuthKey" "$ERRLOG" 2>/dev/null && echo "hint: session dead -> tg-search.sh --login" >&2
  rm -f "$ERRLOG"; exit 1
fi
rm -f "$ERRLOG"

if [ "$RAW" = 1 ]; then printf '%s\n' "$OUT"; exit 0; fi
printf '%s' "$OUT" | "$PY" "$HERE/_format.py"
