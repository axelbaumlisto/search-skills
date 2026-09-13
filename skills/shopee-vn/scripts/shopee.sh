#!/usr/bin/env bash
# Shopee VN search with the local Chrome login session.
#
#   shopee.sh "giày nike" --limit 10 --sort sales      # = shopee.sh search …
#   shopee.sh item https://shopee.vn/product/<shop>/<item>   # variants + prices
#   shopee.sh item <url> --desc                         # + description = real set contents
#   shopee.sh cart                                      # read the live cart
#   shopee.sh orders                                    # past orders: status, total, ETA
#   shopee.sh reviews <url> [--live --stars 1]          # reviews, incl. the 1-star bucket
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
ROOT="$(cd "$HERE/../../.." && pwd)"
. "$ROOT/shared/common.sh"

COOKIES="$(expand_tilde "${SHOPEE_COOKIES:-$CONF_DIR/shopee.cookies.txt}")"
NODE_MODULES="$(expand_tilde "${SHOPEE_NODE_MODULES:-$ROOT/node_modules}")"
EXPORTER="${COOKIE_EXPORTER:-$ROOT/shared/chrome_cookies.py}"
# One user agent for the whole session: the headless browser and this curl must match,
# otherwise the account-info probe and the search look like two different clients.
UA="$(SHOPEE_LIB="$HERE/lib.cjs" NODE_PATH="$NODE_MODULES" node -e 'process.stdout.write(require(process.env.SHOPEE_LIB).UA)')"

refresh() {
  "$PY" "$EXPORTER" shopee.vn --profile "$CHROME_PROFILE" --out "$COOKIES" >/dev/null || {
    echo "cookie export failed (Chrome profile / Keychain)" >&2; return 1; }
  chmod 600 "$COOKIES"; echo "cookies refreshed: $COOKIES"
}

check() {
  curl -s --max-time 20 -b "$COOKIES" -A "$UA" \
    -H "Referer: https://shopee.vn/" -H "x-api-source: pc" -H "x-shopee-language: vi" \
    https://shopee.vn/api/v4/account/basic/get_account_info \
  | "$PY" -c 'import json,sys
d=json.load(sys.stdin).get("data") or {}
print("logged in:", d.get("username"), "| userid", d.get("userid")) if d.get("userid") else sys.exit("session DEAD - run: shopee.sh --refresh-cookies")'
}

case "${1:-}" in
  --refresh-cookies) refresh; exit $?;;
  --check) check; exit $?;;
  -h|--help|"") show_help "$0"; exit 0;;
esac

[ -f "$COOKIES" ] || refresh || exit 1
case "${1:-}" in search|item|reviews|orders|cart|cart-headless|add|qty|rm) ;; *) set -- search "$@";; esac
NODE_PATH="$NODE_MODULES" node "$HERE/shopee.cjs" "$@"
