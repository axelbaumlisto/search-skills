---
name: shopee-search
description: Search Shopee Vietnam (shopee.vn) as the logged-in user and manage that account's cart — live prices, sold counts, ratings, shop and location, plus add/remove items and change quantities. Use when the user asks what something costs in Vietnam, wants to compare VN online prices, find a seller/shop on Shopee, check demand ("сколько продано"), or wants something put in the cart — "поищи на шопи", "shopee", "цены во Вьетнаме", "положи в корзину", "добавь в корзину", "что у меня в корзине".
---

# Shopee VN: search + cart (authenticated)

Search runs a headless Chromium carrying the Shopee session exported from the local Chrome
profile, capturing the search XHR the page itself makes. Cart **writes** cannot work that way
(see below) and are executed as JavaScript inside the user's real Chrome.

## Commands

```bash
S=./skills/shopee-vn/scripts/shopee.sh

$S "giày nike" --limit 10 --sort sales                   # implicit `search`
$S search "máy pha cà phê" --sort price_asc --min 1000000 --max 5000000
$S item https://shopee.vn/product/291717098/20976627790  # variants, models, prices
$S item <url> --desc                                     # + description (real set contents)
$S cart                                                  # read the live cart
$S add <url> --variant "Trắng" --variant "Combo 2 khăn 70x140" --qty 2
$S qty 0 3                                               # row index -> new quantity
$S rm 0                                                  # delete a cart row
$S reviews <url> --live --stars 1                        # read 1-star reviews (see below)
$S orders                                                # My Purchases: status, totals, ETA
$S cart-headless                                         # cookies-only cart — always empty
$S --check              # session alive? prints username/userid
$S --refresh-cookies    # re-export from local Chrome (Keychain prompt possible)
```

Code layout (keep it this way): `lib.cjs` owns cookies/headless browser/parsing, `bridge.cjs`
owns the live-Chrome channel, `scripts/js/*.js` hold the page snippets (one concern each, no
escaping hell inside template literals), `shopee.cjs` is the CLI with one function per
subcommand, `shopee.sh` is the entry point. Add features as a new subcommand or a new js
snippet, never as another copy of the browser boilerplate.

Sorts: `relevancy` (default) | `sales` | `latest` | `price_asc` | `price_desc`.
Other flags: `--limit N` (max 60/page), `--page N`, `--headed` (visible browser), and
`--json PATH` which mirrors any command's output into a file.

Output JSON per item: `name, price_vnd, original_price_vnd, discount_pct, sold,
sold_month, rating, liked, shop, location, sold_out, url`.

## Hard-won rules

- **Never patch `navigator.webdriver`.** Shopee's fingerprint script detects the tampered
  getter and every search returns `error 90309999`. Vanilla Chromium + real cookies passes.
- **Plain curl cannot search.** `/api/v4/search/search_items` needs an anti-bot signature
  computed by page JS (`af-ac-enc-dat`). Only account endpoints like
  `/api/v4/account/basic/get_account_info` work with bare cookies — that is what `--check` uses.
- **The page fires an unfiltered search_items first.** The script only accepts the XHR whose
  URL carries the requested `by=` / `price_min` / `price_max`, otherwise you silently get
  unsorted, unfiltered results.
- **`--min/--max` filter on the pre-discount price**, so displayed promo prices can land below
  `--min`. Compare with `original_price_vnd`.
- **`--sort sales` ignores every quality word in the query.** Three different queries
  (`cotton satin khách sạn`, `percale 100%`, `Hanvico Everon`) returned the *same* mass-market
  bestsellers, because ranking by volume drowns any niche. Premium segments are only reachable
  with `--sort relevancy` plus a `--min` floor.
- **The search price is the cheapest variant's price**, not the one you want. Verified twice:
  a set listed at `499.000₫` was `599.000–619.000₫` in `item`; another at `2.934.000₫` was
  `3.537.000₫` in the size actually needed. Always re-price through `item` before quoting.
- **The title lies about what is in the box — only `--desc` tells the truth.** A set named
  `Bộ Ga Gối 4 món` turned out to be `2 pillowcases + 1 bolster case + 1 sheet` with **no duvet
  cover**, while a `5 món` hotel set shipped a whole summer quilt (`chăn hè`) instead of a cover
  (`vỏ chăn`). Sizing traps hide there too: mattress-height brackets (`5-12cm` / `13-23cm`),
  pillowcase sizes offered only via chat (`50×70` **and** `60×80`), and `mặc định shop sẽ làm ga
  bo chun` (elastic sewn by default). Never recommend a set from its name.
- Prices in the API are VND × 100000; the script already divides.
- Session is bound to this machine's cookies. Requests go out from whatever IP runs the script —
  same checkpoint logic as the Facebook skill in this repo. Keep volume sane, batch queries instead of parallel.
- Search in Vietnamese for real coverage (`giày`, `máy pha cà phê`), optionally also EN/RU terms.

## Cart: works, but only through the user's live Chrome

```bash
$S cart                                            # read the live cart
$S add https://shopee.vn/product/291717098/20976627790 \
     --variant "Trắng" --variant "Combo 2 khăn 70x140" --qty 2
$S qty 0 3                                         # row index -> new quantity
$S rm 0                                            # delete row
```

Mutations run as JavaScript inside the real Chrome through `ChromeBridge.app`
(AppleScript applet) — see `bridge.cjs` and the snippets in `scripts/js/`.

Setup, needed once per machine:
1. Build it once: `./skills/shopee-vn/bridge/build_bridge.sh`. It installs
   `~/Applications/ChromeBridge.app` — a *visible* folder on purpose:
   macOS permission pickers cannot browse into a dotted path like `~/.pi`. It carries a bundle id
   and an ad-hoc signature, so its TCC identity survives moves and
   rebuilds; without an identifier `tccutil` refuses it ("No such bundle identifier") and grants
   silently fail to bind. Re-sign with `codesign --force --deep -s -` after any edit.
2. Approve the “ChromeBridge wants to control Google Chrome” dialog. Inside a **detached tmux**
   no prompt can ever appear (no GUI-responsible app) — that is why the applet is launched with
   `open`, which makes the applet itself the responsible process. Run it once from a real terminal.
3. Chrome: *View → Developer → Allow JavaScript from Apple Events*. Writing
   `browser.allow_javascript_apple_events` into `Local State`/`Preferences` does **not** work;
   only the menu toggle does. Without it every call fails with `-1723 Access not allowed`.
4. Syntax matters: `tell active tab of first window … execute javascript` works,
   `execute javascript … in t` fails with `-1700`.

Hard-won cart rules:
- **Pick one variant option per call.** A tier with a single option auto-selects after the
  first pick; clicking it again in the same tick silently clears it and the add is dropped.
  `add` verifies the selection and retries before clicking Add To Cart.
- **Never match `Delete` by loose text** when confirming a deletion — row buttons carry the
  same label, and one loose match already wiped an unrelated cart row. `js/confirm.js` only
  looks inside a visible modal. Shopee usually deletes without a modal, so `no-modal` is normal.
- After cart changes the exported cookies go stale; `--refresh-cookies` re-exports them.
- **Stock is per variant combination, not per listing.** A size can be `aria-disabled="true"`
  for one colour and available for another — check before blaming the automation. `add` now
  fails loudly with `variants not selected: [...]` when the wanted option is sold out.
- **Quantity is capped by stock**, and the cart's Increase button then silently ignores every
  input: plain `.click()`, a full pointer-event sequence, and the React native-setter trick on
  the quantity input all do nothing. Read `N pieces available` on the product page before
  assuming the qty command is broken.
- **Row indices shift after every delete.** Shopee re-renders the list, so `rm 0` three times is
  correct for clearing three rows — never precompute a list of indices and loop over it.
- A product page can serve several fibre lines from one listing (Royal sells `Sợi Cotton` and
  `Sợi Tre`/bamboo side by side, and the bamboo one is what the 1-star reviews complain about).
  Check which line a variant belongs to before adding.
- Some pdp payloads omit the title; `item` falls back to the tab title.

## Reviews — the only way to judge a product

Star averages are useless here: everything sells at 4.8–4.9. Read the 1-star bucket and
compute its share instead.

```bash
$S reviews <url>                     # headless: captures the page's own ratings XHR (~6 newest)
$S reviews <url> --live --stars 1    # live Chrome: switches the star filter, returns section text
```

- The endpoint is **`/api/v2/item/get_ratings`** — the v4 path is gone. A scripted `fetch` to it
  is refused with `90309999` (`business: "Rating"`) **even inside the real Chrome**, because the
  signature is attached only by Shopee's own XHR wrapper. So: capture what the page requests, or
  read the rendered DOM.
- Headless renders no star-filter tabs and no pager, so low-star reviews are only reachable with
  `--live`, which clicks the `N Star (…)` tab and returns the ratings section as text.
- Vietnamese praise is phrased as a negated defect: **`không phai màu`** = *does not fade*,
  `không xù lông` = *does not shed*. A naive keyword count reads praise as complaints — always
  discard matches preceded by `không`.
- Useful defect keywords: `xù lông` (sheds lint), `ra bụi` (sheds dust), `phai màu` (fades),
  `không thấm` (not absorbent), `mỏng` (thin), `cứng`/`thô ráp` (rough), `sai màu`/`sai size`.

## Orders

`orders` reads *My Purchases* through the live Chrome and structures each block into
`{shop, status, total, delivery, items[]}`. Statuses seen: `TO PAY`, `TO SHIP`, `TO RECEIVE`,
`COMPLETED`, `CANCELLED`. Two parsing traps, both already handled:

- the text block starts **right after** the `Order Shop Section |` marker, so the shop name is
  field `[0]`, not `[1]` — using `[1]` silently returns the word `Chat`;
- `Go to PDP` appears only once per order, so anchoring line items on it drops every item but
  the first. Match on the product name that repeats before each `Variation:` instead.

It is also the only way to see what was actually charged: the cart shows list prices, the order
shows the amount after shop vouchers and platform discounts (a real order dropped ~19% between
the two).

## What the API never shows you

The rendered cart page carries discounts absent from every JSON payload: `Streaming Price at …`
(a live-stream price, seen at −16%), `Add N more for X% off` bundles, and `Up to …đ off voucher
available`. With Screen Recording granted, a screenshot of the live cart is the fastest way to
spot them — `screencapture` from the applet, then read the PNG.

## What still cannot be done headlessly

Headless reads the cart as empty and every write is refused. Verified dead ends — do not retry:

| approach | result |
|---|---|
| `fetch('/api/v4/cart/add_to_cart')` from page context | `error 90309999` |
| same via `XMLHttpRequest` (their interceptor lives on XHR) | `error 90309999` |
| hijacking a live signed `cart/mini` request into `add_to_cart` via `route.continue({url, postData})` | `error 90309999` — the signature is bound to path+body |
| clicking the variant button (Playwright click / mouse at DOM coords / JS `.click()`) | nothing selects: the anti-bot serves a page whose React handlers are inert |
| headless Chromium, `channel:'chrome'` headed, Chrome + CDP on a copy of the real profile | all identical, even while logged in as the real user |
| replaying a captured signed search request with curl (same URL, same `af-ac-enc-dat`/`x-sap-sec`) | `error 90309999` — so there is no browser-free API at all |

The rejection body decodes to `{"business":"MPBuyerOrder","mfr_captcha":""}` — Shopee's risk engine
gates cart writes behind device verification. Chrome 136+ also refuses `--remote-debugging-port` on
the default profile, so CDP on the real profile is not an option either. Hence the AppleScript bridge.

## Files

- cookies: `~/.config/search-skills/shopee.cookies.txt` (mode 600, Netscape) — override with `$SHOPEE_COOKIES`
- exporter: `shared/chrome_cookies.py shopee.vn --profile Default`
- playwright: `npm install` in the repo root, or point `$SHOPEE_NODE_MODULES` at an existing install
- bridge applet: `skills/shopee-vn/bridge/build_bridge.sh` (installs `~/Applications/ChromeBridge.app`)
- debug: `SHOPEE_DEBUG=1` prints the built URL and accepted/skipped XHRs
