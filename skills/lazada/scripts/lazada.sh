#!/usr/bin/env bash
# Lazada — история заказов из живого залогиненного Chrome.
# Страна: LAZADA_REGION=th (по умолчанию) | vn, либо готовая обёртка lazada-vn.sh.
#
#   lazada.sh orders                        # вся история, таблицей
#   lazada.sh orders --query "touch|จอ"     # только подходящие позиции
#   lazada.sh orders --pages 2              # ограничить число запросов
#   lazada.sh orders --tab TO_SHIP          # ALL TO_PAY TO_SHIP TO_RECEIVE TO_REVIEW
#   lazada.sh orders --json                 # машинный вывод
#   lazada.sh cart                          # что лежит в корзине
#   lazada.sh cart --remove 2               # убрать позицию (номер или слово из названия)
#   lazada.sh add "<url|pdp-id>" --qty 2    # положить товар в корзину
#
# Chrome должен быть запущен и залогинен на lazada.co.th / lazada.vn; страница откроется сама.
set -euo pipefail
exec node "$(dirname "$0")/cli.cjs" "$@"
