#!/usr/bin/env bash
# Shopee search with the local Chrome login session.
# Region: SHOPEE_REGION=vn (default) | th  -> see scripts/regions.cjs
#
#   shopee.sh "giày nike" --limit 10 --sort sales      # = shopee.sh search …
#   shopee.sh item https://shopee.vn/product/<shop>/<item>   # variants + prices
#   shopee.sh item <url> --desc                         # + description = real set contents
#   shopee.sh cart                                      # read the live cart
#   shopee.sh orders                                    # заказы: статус, сумма, сроки
#   shopee.sh reviews <url> [--live --stars 1]          # отзывы, в т.ч. однозвёздочные
#   shopee.sh add <url> --variant "Trắng" --variant "Combo 2 khăn 70x140" --qty 2
#   shopee.sh qty 0 3                                   # row index -> new quantity
#   shopee.sh rm 0                                      # delete a cart row
#   shopee.sh cart-headless          # cart via cookies only (Shopee returns it empty)
#   shopee.sh --refresh-cookies      # re-export the session from local Chrome
#   shopee.sh --check                # is the session still logged in?
#
# search/item run headless; cart writes go through the live Chrome (ChromeBridge.app).
#
# Sorts: relevancy (default) | sales | latest | price_asc | price_desc
# NB: --min/--max filter Shopee-side on the pre-discount price.
# NB: sort=sales ignores quality words in the query and returns the same mass-market
#     bestsellers for every phrasing. Reach a premium segment with relevancy + --min.
# NB: the search price is the CHEAPEST variant's price, not the one you need.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# Где лежат сессии и окружение — дело установки, не скилла.
COOKIE_DIR="${SHOPEE_COOKIE_DIR:-$HOME/.config/shopee-search/cookies}"

REGION="$(printf '%s' "${SHOPEE_REGION:-vn}" | tr '[:upper:]' '[:lower:]')"
case "$REGION" in
  vn) HOST="shopee.vn";    LANG_H="vi"; COOKIES="$COOKIE_DIR/shopee.cookies.txt";;
  th) HOST="shopee.co.th"; LANG_H="th"; COOKIES="$COOKIE_DIR/shopee_th.cookies.txt";;
  *)  echo "unknown SHOPEE_REGION=$REGION (vn|th)" >&2; exit 2;;
esac
export SHOPEE_REGION="$REGION"

NODE_MODULES="${SHOPEE_NODE_MODULES:-$HERE/../node_modules}"
PY="${SHOPEE_PYTHON:-python3}"
EXPORTER="${SHOPEE_COOKIE_EXPORTER:-$HERE/chrome_cookies.py}"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

# Keychain reads need a GUI session. Over SSH/tmux (`launchctl managername` = Background)
# `security` fails with "User interaction is not allowed", so relay the export through
# ChromeBridge.app, which `open` starts inside the Aqua session.
refresh() {
  local cmd="$PY $EXPORTER $HOST --profile Default --out $COOKIES"
  if $cmd >/dev/null 2>&1; then chmod 600 "$COOKIES"; echo "cookies refreshed: $COOKIES"; return 0; fi
  printf 'set r to ""\ntry\n\tset r to do shell script "%s 2>&1"\non error e\n\tset r to "ERR: " & e\nend try\nreturn r\n' \
    "$cmd" > /tmp/shopee_as.applescript
  rm -f /tmp/shopee_js.out
  open -a /Applications/ChromeBridge.app 2>/dev/null || { echo "cookie export failed and no ChromeBridge.app" >&2; return 1; }
  for _ in $(seq 1 30); do sleep 1; [ -f /tmp/shopee_js.out ] && break; done
  grep -q 'wrote .* cookies' /tmp/shopee_js.out 2>/dev/null || {
    echo "cookie export failed: $(cat /tmp/shopee_js.out 2>/dev/null)" >&2; return 1; }
  chmod 600 "$COOKIES"; echo "cookies refreshed via ChromeBridge: $COOKIES"
}

check() {
  curl -s --max-time 20 -b "$COOKIES" -A "$UA" \
    -H "Referer: https://$HOST/" -H "x-api-source: pc" -H "x-shopee-language: $LANG_H" \
    "https://$HOST/api/v4/account/basic/get_account_info" \
  | "$PY" -c 'import json,sys
d=json.load(sys.stdin).get("data") or {}
print("logged in:", d.get("username"), "| userid", d.get("userid"), "| phone", d.get("phone")) if d.get("userid") else sys.exit("session DEAD - run with --refresh-cookies")'
}

case "${1:-}" in
  --refresh-cookies) refresh; exit $?;;
  --check) check; exit $?;;
  --bridge-stop) : > /tmp/shopee_job.quit; echo "bridge server asked to quit"; exit 0;;
  -h|--help|"") awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "$0"; exit 0;;
esac

[ -f "$COOKIES" ] || refresh || exit 1
case "${1:-}" in search|item|reviews|orders|order|cart|cart-headless|add|qty|rm) ;; *) set -- search "$@";; esac
NODE_PATH="$NODE_MODULES" node "$HERE/shopee.cjs" "$@"
