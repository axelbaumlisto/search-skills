#!/usr/bin/env bash
# Новые сообщения Zalo по списку чатов → себе в Telegram (Избранное).
# Пример в cron:  */15 * * * * ~/work/search-skills/skills/zalo/scripts/zalo-notify.sh "Trung,Toàn Phát,Thuỳ Linh"
set -euo pipefail
FILTER="${1:-}"
Z="$(cd "$(dirname "$0")" && pwd)/zalo.mjs"
OUT="$(node "$Z" watch "$FILTER" --full 2>/dev/null | grep -v '^#' || true)"
[ -z "$OUT" ] && exit 0
echo "$OUT" | grep -q 'НОВОЕ' || exit 0
cd ~/work/tg_agent/naked
set -a; source ~/work/tg_agent/.env; set +a
.venv/bin/python skills/telegram-reader/scripts/tg_send.py --session zverozabr_session send me "Zalo, новое:
$OUT"

