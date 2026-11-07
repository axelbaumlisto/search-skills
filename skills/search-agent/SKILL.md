---
name: search-agent
description: Router and playbook for multi-source local search across Telegram classifieds, Facebook Marketplace, Chợ Tốt, Google Places, Threads discussions and a real logged-in browser. Use when the user wants to find a product, price, rental, service, shop or seller — especially in Vietnam and Thailand — and it is not obvious which source to hit, or when the answer needs several sources cross-checked ("найди где купить X", "сколько стоит X здесь", "найди продавца/контакт", "проверь наличие", "собери варианты", "найди жильё в аренду и присылай новые").
---

# Search agent

One entry point for "find me X around here". Picks the right source, runs them
in the right order, and reports only what was actually verified.

## Source selection

| The user wants | Use | Why |
|----------------|-----|-----|
| second-hand / private-seller goods, local prices | `marketplace-search` (Facebook) | biggest local supply, real asking prices |
| same in Vietnam, price statistics per city | Chợ Tốt public API (recipe below) | no login, full category dump, medians in one call |
| rent a house or buy anything used and **keep watching** for new offers | `listing-monitor` | one TOML per search; Chợ Tốt + FB + Telegram + muaban, dedup, filter, sends only new to Telegram, launchd every 6 h |
| classifieds, expat chatter, "кто продаёт", contacts | `telegram-search` | city/classifieds channels, direct `@username` |
| what people say about a tool, product or topic right now | `threads` | official Meta API, keyword search, no scraping |
| a physical shop: address, rating, phone, hours | `google-places` | authoritative Places data, not scraped guesses |
| a specific online store page, stock, size grid | `browser-scout` | real browser gets past 403/JS shells |
| broad facts, reviews, model comparisons | built-in `web_search` / `fetch_content` | cheapest, no infrastructure |

## Default recipe for a product hunt

```bash
TG=~/.pi/agent/skills/telegram-search/scripts
FB=~/.pi/agent/skills/marketplace-search/scripts
GP=~/.pi/agent/skills/google-places/scripts
TH=~/.pi/agent/skills/threads/scripts
BR=~/.pi/agent/skills/browser-scout/scripts

# 1. local supply, one city at a time (geo-verified)
$FB/fb-search.sh "sneakers 45" danang --limit 15

# 2. classifieds chatter — batch several phrasings, never parallel calls
$TG/tg-search.sh --batch '[{"query":"кроссовки 45","limit":20},{"query":"giày 45","limit":20},{"query":"sneakers 29cm","limit":20}]'

# 3. brick-and-mortar options with ratings
$GP/places.sh "sneaker store Da Nang" --limit 5

# 4. only for finalists: confirm stock/price on the store page
$BR/browse.sh "https://shop.example/product" --chars 6000
```

Chợ Tốt (Vietnam classifieds, no auth). `cg` = category (1000 real estate,
2060 bicycles, 2020 motorbikes), `region_v2` = city (3017 Đà Nẵng, 13000 HCMC),
`area_v2` = district (503112 Phú Quốc), `st=s,k` = sell ads only, `o` = offset:

```bash
curl -s -A Mozilla/5.0 "https://gateway.chotot.com/v1/public/ad-listing?cg=2060&region_v2=3017&st=s,k&limit=50&o=0"
# unknown code: search once with q=<words> and read category / region_v2 from the ads
# item link: https://www.chotot.com/<list_id>.htm ; full body: .../v1/public/ad-listing/<list_id>
```

Monitoring (rentals, bikes, any category/city) — do not hand-roll it, use the skill:

```bash
RM=~/.pi/agent/skills/listing-monitor
uv run --project $RM listing-monitor refresh --config ~/.config/listing-monitor/example.toml --dry-run
# new city/budget = copy $RM/configs/*.example.toml outside the repo, edit, `seed` old links, add a scheduler
```

## Rules learned the hard way

- **Language matters more than cleverness.** In VN/TH run the query in Russian,
  English and Vietnamese/Thai; each hits a different seller crowd
  (`кроссовки` / `sneakers` / `giày`).
- **Short stems win.** Telegram and Facebook both do literal matching:
  `кроссовки` finds what `белые кроссовки 45 размер` misses. Filter afterwards.
- **Sizes are a trap.** Nike US 11 = UK 10 = EU 45 = 29 cm; adidas Vietnam
  labels shoes in **UK**. Always convert before claiming a size is available,
  and re-check on the product page.
- **One query per city.** Facebook geo-search is per-city; "Vietnam" as a whole
  is not a location. Run danang / hcmc / hanoi separately.
- **Verify before promising.** A marketplace title saying "size 36-45" means the
  seller's range, not stock. Confirm with `fb-search.sh --detail <id>` or
  `browse.sh` on the shop page.
- **Never claim availability without evidence.** Quote price, size, link and
  date for every option you present. Distinguish "seen in stock" from "listed".
- **Batch, don't parallelise.** Both the Telegram session and the remote browser
  are single-tenant. Telegram answers "session is busy"; the browser is worse —
  it silently returns *another job's page*, so always verify the returned id
  matches the one you asked for. The wrappers serialise browser jobs on
  `/tmp/fb-browser.lock`, but anything you run by hand must take the same lock.
- **Long remote jobs must be detached.** The wrappers already use
  `nohup` + polling; if you call the underlying scripts yourself over ssh, do
  the same or the call dies mid-flight.

## Health check when something returns nothing

```bash
$FB/fb-search.sh --health          # remote Chrome active + logged in?
$TG/tg-search.sh --dialogs-list --limit 5   # Telegram session alive?
$GP/places.sh --budget             # Places quota left for the month
```

Empty result with a healthy source usually means the query was too specific or
`--dialogs`/city scope was too narrow — widen before concluding "нет ничего".

## Reporting format

Give the user a compact table: price, what it is, size/condition, source, link.
Sort by relevance to the actual ask, not by price. Add a one-line verdict and
name the residual risk (e.g. "size unconfirmed, seller lists a range").

Links: a Facebook Marketplace item opens only for a logged-in Facebook user —
say so next to the link. A post inside a group/chat: give the group link first
(join), then the post link under it.

Details per source live in the sibling skills: `telegram-search`,
`marketplace-search`, `google-places`, `threads`, `browser-scout`,
`listing-monitor`.

## Threads vs the rest

`threads` is not a classifieds source — it is opinion and discussion. Reach for it
when the question is "what are people saying about X" rather than "who sells X".
It runs on the official Meta API, so results are complete and stable, unlike scraping.

```bash
$TH/threads.py search "claude code" --limit 20      # popular
$TH/threads.py search "claude code" --type RECENT   # newest
```
Infrastructure details are documented by each source skill; private runtime paths stay in environment variables and XDG config.
