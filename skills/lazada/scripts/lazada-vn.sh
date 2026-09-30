#!/usr/bin/env bash
# Lazada Vietnam — то же самое, что lazada.sh, но на lazada.vn.
# Обёртка ровно из одной строки: страна выбирается переменной, код общий.
set -euo pipefail
LAZADA_REGION=vn exec "$(dirname "$0")/lazada.sh" "$@"
