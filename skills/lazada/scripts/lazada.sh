#!/usr/bin/env bash
# Lazada Thailand — история заказов из живого залогиненного Chrome.
#
#   lazada.sh orders                        # вся история, таблицей
#   lazada.sh orders --query "touch|จอ"     # только подходящие позиции
#   lazada.sh orders --pages 2              # ограничить число запросов
#   lazada.sh orders --tab TO_SHIP          # ALL TO_PAY TO_SHIP TO_RECEIVE TO_REVIEW
#   lazada.sh orders --json                 # машинный вывод
#
# Chrome должен быть запущен и залогинен на lazada.co.th; страница откроется сама.
set -euo pipefail
exec node "$(dirname "$0")/cli.cjs" "$@"
