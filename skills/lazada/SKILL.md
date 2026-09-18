---
name: lazada-search
description: Read the purchase history of a Lazada Thailand (lazada.co.th) account and search the catalogue — what was ordered, from which shop, for how much, in which state, plus live prices, sold counts and review counts. Use when the user asks whether they bought something before, wants the price of a past purchase, needs to recall a shop, checks unfinished orders, or wants current Thai prices — "did I buy", "what did I order", "find it in my orders", "how much did I pay for", "search lazada".
---

# Lazada Thailand: orders + catalogue search

Reads from the live, logged-in Chrome. Thailand only: one country, so there is no
region table — a second country means adding the host here, not copying the skill.

## Commands

```bash
S=~/.pi/agent/skills/lazada-search/scripts

$S/lazada.sh orders                              # whole history as a table
$S/lazada.sh orders --query "monitor jo"         # filter by words (OR logic)
$S/lazada.sh orders --pages 2                    # fewer requests, faster
$S/lazada.sh orders --tab TO_SHIP                # ALL TO_PAY TO_SHIP TO_RECEIVE TO_REVIEW
$S/lazada.sh orders --json                       # machine-readable
$S/lazada.sh search "portable monitor touch"     # catalogue search
$S/lazada.sh search "..." --sort priceasc        # priceasc | pricedesc | pop
```

Words in `--query` are split on spaces or a vertical bar and matched with OR logic
against title, shop and variation. Case and script do not matter; Thai works.

## Output

Orders: `orderId`, `title`, `variation`, `price`, `qty`, `status`, `delivery`, `shop`,
`shopLink`, `url` per order line.

Search: `name`, `price`, `sold`, `reviews`, `inch`, `res`, `nit`, `touch`, `city`, `url`.

Measured on a real account: a history of ~850 order lines comes back in 8 requests,
about a minute.

## How it works, and why

The orders page itself posts to `/customer/api/sync/order-list` with a body of
`{ultronVersion:"2.0"}`. The same endpoint accepts `page` and `pageSize`, and with
`pageSize=100` a long history takes under ten requests.

**Scraping the DOM is the wrong tool here**: the list can run to dozens of pages
behind Next-UI pagination, which means a click and a re-parse per page.

**Do not guess the parameter names.** `pageNum`, `currentPage` and `pageIndex` are
silently ignored: the response is `success:true` and always the first page. The real
names live in `linkage.common.queryParams` of that same response — gzip+base64 behind
a `^^$$<md5>{$_$}` prefix, wrapping a `QueryBuyerOrderListRequest` with `tab`, `page`,
`pageSize` and `chosenTimeLimit`.

**The async endpoint `/customer/api/async/order-list` is not needed.** It wants a full
Ultron payload with per-component signatures; sync with `page` does the same job.

## Gotchas

**Order status lives on the shop component, not the line.** A line only carries
`delivery.status = "success"`, which reads the same for delivered and cancelled orders.
The human-readable `Delivered`/`Cancelled` comes from the `orderShop` component, keyed
by `shopGroupKey` matching the line's `groupId`.

**`pageSize` counts orders, not lines.** A hundred orders arrive as ~126 lines, so the
end of the list is detected by "no new lines", not by page size. `pageSize=200` still
returns about the same count — the ceiling is around a hundred.

**Never escape the vertical bar in a query.** Escaped, `touch|screen` is matched as one
literal string and finds nothing.

**There is no star rating in the card text.** `(89)` is the number of ratings; the stars
are drawn as icons. A naive regex reports "5.6 stars", which is really the 15.6" size.

**No mtop SDK on the page** — `window.lib.mtop` is absent, so signed requests to
`acs-m.lazada.co.th` cannot be assembled from the console.

**Catalogue search renders 40 cards at once** and, unlike Shopee TH, does not depend on
the browser window being visible.

## Requirements

Chrome running and logged in to `lazada.co.th`, ChromeBridge.app in place, and
"View -> Developer -> Allow JavaScript from Apple Events" enabled in Chrome. The bridge
is shared with the `shopee` skill: `bridge.cjs` is not copied, it is required from there.
