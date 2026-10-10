#!/usr/bin/env bash
# Новые сообщения Zalo по списку чатов → себе в Telegram (Избранное).
# Пример в cron:  */15 * * * * ~/work/search-skills/skills/zalo/scripts/zalo-notify.sh "Trung,Toàn Phát,Thuỳ Linh"
set -euo pipefail
FILTER="${1:-}"
Z="$(cd "$(dirname "$0")" && pwd)/zalo.mjs"
OUT="$(node "$Z" watch "$FILTER" --full 2>/dev/null | grep -v '^#' || true)"
[ -z "$OUT" ] && exit 0
echo "$OUT" | grep -q 'НОВОЕ' || exit 0
# Отправитель в Telegram — из окружения: TG_SEND_DIR (каталог с .venv и tg_send.py), TG_ENV_FILE, TG_SESSION.
: "${TG_SEND_DIR:?задай TG_SEND_DIR}" "${TG_ENV_FILE:?задай TG_ENV_FILE}" "${TG_SESSION:?задай TG_SESSION}"
cd "$TG_SEND_DIR"
set -a; source "$TG_ENV_FILE"; set +a
.venv/bin/python skills/telegram-reader/scripts/tg_send.py --session "$TG_SESSION" send me "Zalo, новое:
$OUT"

