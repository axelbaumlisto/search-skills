---
name: shopee-th-search
description: Search Shopee Thailand (shopee.co.th) as the logged-in user and manage that account's cart — live THB prices, sold counts, ratings, shop and province, plus add/remove items, change quantities, read reviews and past orders. Use when the user asks what something costs in Thailand, wants Thai suppliers or equipment prices (kitchen/bar/stainless steel, appliances, furniture), compares TH vs VN prices, or says "поищи на тайском шопи", "цены в Таиланде", "shopee th", "сколько стоит в Бангкоке".
---

# Shopee TH: search + cart (authenticated)

Same engine as the `shopee-search` (Vietnam) skill — **the code is shared, not forked**.
Everything country-specific lives in one table, `shopee-search/scripts/regions.cjs`.
This skill only pins `SHOPEE_REGION=th`. To support another Shopee country, add a key
there; never copy the scripts.

Account: `zverozabr` (userid 241866006, TH phone). Different account from the VN skill.

## Commands

```bash
T=~/.pi/agent/skills/shopee-th-search/scripts/shopee-th.sh

$T "โต๊ะสแตนเลส" --limit 10 --sort price_asc --min 2000   # implicit `search`
$T search "เครื่องปั่นน้ำผลไม้" --sort sales
$T item https://shopee.co.th/product/332401889/25541404495   # variants, price, stock
$T item <url> --desc                                          # + description
$T reviews <url> --stars 1                                    # 1-star bucket
$T cart                                                       # read the live cart
$T add <url> --variant "2000ML" --qty 2
$T qty 0 3                                                    # row index -> quantity
$T rm 0                                                       # delete a cart row
$T orders                                                     # My Purchases
$T --check                                                    # session alive?
$T --refresh-cookies                                          # re-export from Chrome
$T --bridge-stop                                              # quit the resident bridge
```

Every TH command drives the live Chrome, so read § *Cart* in the VN skill first: the bridge
works in its **own dedicated tab** and runs as a **resident server started once** — it must
never navigate the user's tab or pull focus per call.

Sorts, `--limit`, `--page`, `--json PATH` behave exactly as in the VN skill.
Output keys are region-suffixed: `price_thb`, `original_price_thb`, `total_thb`.

## The one big difference from VN: TH refuses headless

`shopee.vn` answers the search/pdp XHR to a headless Chromium carrying real cookies.
**`shopee.co.th` does not** — it returns

```json
{"error":90309999,"6":{"1":"mfr…"}}   →   {"business":"Search","mfr":"0","mfr_captcha":"","pop_up":false}
```

and renders `Verify to Continue`. Verified dead ends, do not retry them:

| attempt | result |
|---|---|
| headless + fresh cookies, locale `th-TH`/tz `Asia/Bangkok` | `90309999` |
| locale `en-US`, tz `Asia/Saigon` (matching the real `language=en` / `ssr-tz` cookies) | `90309999` |
| adding the `SPC_IA=1` cookie that VN has and TH lacks | `90309999` |
| same for the pdp endpoint | `no pdp payload` |

So for TH, `search`, `item` and `reviews` **also** run through the live Chrome and read the
rendered DOM (`region.searchLive = true` in `regions.cjs`). `--headless` forces the old path
if you want to re-test the block. Consequences:

- results carry `"source": "live-dom"` and a `raw` field with the untouched card text —
  when a parsed number looks wrong, read `raw` before trusting it;
- `rating` and `location` are missing on some cards (Shopee renders them lazily);
- `sold` vs `sold_month`: the grid shows either `2k+ sold` (lifetime) or `982 Sold/Month`.
  The parser fills only the matching field, so a `null` in one of them is normal;
- the first rows of every result page are a **paid promo strip** that ignores the query
  (a search for a blender returned a vacuum cleaner). They lack `data-sqe="item"` and are
  dropped; pass `--ads` to see them, they come back as `promoted: true`;
- `item` returns `price` as text (`฿1,799`) plus `price_block`, because the header carries
  voucher lines the JSON never had.

## Thai search terms that actually work

Search in Thai — English queries return a fraction of the catalogue.

| what | Thai |
|---|---|
| stainless table / worktable | `โต๊ะสแตนเลส`, `โต๊ะเตรียมอาหารสแตนเลส` |
| stainless 304 | `สแตนเลส 304` |
| sink | `ซิงค์ล้างจาน` (1 bowl: `ซิงค์ล้างจาน 1 หลุม`) |
| blender / commercial blender | `เครื่องปั่น`, `เครื่องปั่นเชิงพาณิชย์` |
| juicer | `เครื่องปั่นน้ำผลไม้` |
| coffee counter | `เคาน์เตอร์กาแฟ` |
| glass block | `บล็อกแก้ว` |
| shelving | `ชั้นวางของสแตนเลส 304` |
| second-hand | append `มือสอง` |

Province names come back in English (`Bangkok`, `Samut Sakhon`, `Samut Prakan`,
`Prachin Buri`) — useful for shipping distance, Samut Sakhon/Prakan are the metal-fab belt.

## Cart, reviews, orders

Identical mechanics and identical traps to the VN skill — read
`~/.pi/agent/skills/shopee-search/SKILL.md` § *Cart*, § *Reviews*, § *Orders* before using
them. TH-specific notes:

- **TH option labels carry a trailing space** in `aria-label` (`"2000ML "`). `pick_one.js`
  compares trimmed now; that was the cause of `variants not selected: []`.
- Cart and order totals are `฿` — every currency regex in `js/*.js` accepts `[฿₫]`.
- Cart price can differ from the listing price (`฿1,799` on the pdp → `฿1,819` in cart)
  because a shop voucher had not started yet. Quote from the cart, not from search.
- The UI language of this account is **English** (`language=en` cookie), so all the
  English selectors (`Variations:`, `Increase`, `Add To Cart`) work as in VN.
- `cart-headless` is pointless here — the same block applies.

## Session / cookies

- cookies: `~/work/tg_agent/naked/.secrets/cookies/shopee_th.cookies.txt` (mode 600, Netscape)
- **Keychain over SSH/tmux**: `launchctl managername` reports `Background`, so `security`
  fails with *User interaction is not allowed* and the cookie export dies. `--refresh-cookies`
  now detects this and relays the export through `ChromeBridge.app`, which `open` starts
  inside the Aqua session where Keychain access is permitted. That trick works for any
  GUI-gated command, not just cookies.
- `--check` uses `/api/v4/account/basic/get_account_info`, the one endpoint that answers to
  bare cookies without the anti-bot signature.

## Files

- shared engine: `~/.pi/agent/skills/shopee-search/scripts/` (`regions.cjs` = country table,
  `lib.cjs` = cookies/headless, `bridge.cjs` = live Chrome, `js/*.js` = page snippets)
- this skill: `scripts/shopee-th.sh` — a 3-line wrapper setting `SHOPEE_REGION=th`
