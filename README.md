# search-skills

Three agent skills for **live** search on platforms that have no usable public API:
Shopee Vietnam, Facebook Marketplace and Telegram. Each one drives *your own*
logged-in session, returns structured JSON, and documents the anti-bot walls it
had to get through — so an LLM agent (or you) can ask "what does this cost here,
who sells it, and what do buyers complain about" and get a real answer.

| Skill | What it answers | Path |
|---|---|---|
| [shopee-vn](skills/shopee-vn/SKILL.md) | VN online prices, sold counts, variants, reviews, cart, order history | headless Chromium + the real Chrome for writes |
| [fb-marketplace](skills/fb-marketplace/SKILL.md) | second-hand prices in a specific city, seller listings, Page reviews | plain HTTP replay of the Marketplace GraphQL query |
| [telegram-search](skills/telegram-search/SKILL.md) | what people actually post in local chats: listings, contacts, rentals | Telethon over your joined chats |

No scraping farm, no proxies, no fake accounts: every skill is a thin, paced
wrapper around a session you already have.

---

## Shopee VN — prices, variants, reviews, cart

![shopee](docs/images/shopee-search.png)

```bash
S=./skills/shopee-vn/scripts/shopee.sh

$S "giày nike nam" --limit 10 --sort sales        # search (headless)
$S item <product-url> --desc                      # variants, per-model stock, real contents
$S reviews <product-url> --live --stars 1         # the only reviews worth reading
$S cart                                           # read the live cart
$S add <url> --variant "Trắng" --qty 2            # write — goes through your real Chrome
$S orders                                         # what was actually charged
```

Three things this skill exists to tell you, all learned the hard way:

* the **search price is the cheapest variant's** price — re-price through `item`
  before quoting anything;
* the **title lies about what is in the box** — only `--desc` lists the real
  contents (a "4-piece set" turned out to have no duvet cover);
* **star averages are useless** (everything sells at 4.8) — read the 1-star
  bucket and compute its share.

Cart *writes* cannot be automated at all from a scripted browser: Shopee's risk
engine refuses them with `error 90309999`, including a replayed signed request.
They run as JavaScript inside your real Chrome through a small AppleScript
applet — build it with `./skills/shopee-vn/bridge/build_bridge.sh`.

## Facebook Marketplace — geo-scoped second-hand prices

![facebook](docs/images/fb-marketplace.png)

```bash
S=./skills/fb-marketplace/scripts

$S/fb-search.sh "iphone 15" danang --limit 10
$S/fb-search.sh "giày" hcmc --min 300000 --max 3000000
$S/fb-search.sh "google pixel" --lat 9.5120 --lng 100.0136 --radius 25
$S/fb-cookies.sh                                   # session alive? budget left?
python3 $S/fb_reviews.py <page-slug>               # "92% recommend (37 reviews)"
```

The default path sends **one HTTPS request** — it replays the same GraphQL query
the Marketplace page makes, with your cookies and a freshly scraped `fb_dtsg`.
Geo is real (lat/lng/radius), and the wrapper refuses to show wrong-city results
instead of silently falling back to your account's location.

Because this runs on a real personal account it is paced on purpose: ≥4 s +
jitter between requests, 40 requests/hour, and hard-stop detection of Facebook's
checkpoint markers (exit code 4 means *stop*, not *retry*).

Cities preset: `bangkok pattaya phuket samui phangan chiangmai krabi danang hcmc
hanoi nhatrang hoian` — anything else via `--lat/--lng/--radius`.

## Telegram — what people post in local chats

![telegram](docs/images/telegram-search.png)

```bash
S=./skills/telegram-search/scripts

$S/tg-search.sh "аренда байка" --limit 20 --dialogs 250
$S/tg-search.sh "iphone" --channel danang --since 2026-09-01T00:00:00
$S/tg-search.sh --in @somechat "стрим" --mine      # your own messages in one chat
$S/tg-search.sh --context @somechat 106157 --before 20 --after 20
$S/tg-search.sh --batch '[{"query":"скутер"},{"query":"xe máy","limit":40}]'
```

Telegram has no cross-chat search API, so the reader iterates your dialogs and
searches each one. **Scanning fewer than ~200 dialogs silently returns zero
matches** for queries that do have hits — that single fact is why this wrapper
exists.

---

## Install

```bash
git clone <this repo> && cd search-skills
npm install                     # playwright, for the Shopee skill and doc shots
pip install -r requirements.txt # telethon + pycryptodome
cp .env.example ~/.config/search-skills/.env && chmod 600 ~/.config/search-skills/.env
```

Then per skill, once:

```bash
# Shopee: export the session from your local Chrome
./skills/shopee-vn/scripts/shopee.sh --refresh-cookies && ./skills/shopee-vn/scripts/shopee.sh --check
# Shopee cart writes only: build the AppleScript bridge (macOS)
./skills/shopee-vn/bridge/build_bridge.sh

# Facebook: export cookies, then capture the GraphQL template once
./skills/fb-marketplace/scripts/fb-cookies.sh refresh
#   -> skills/fb-marketplace/templates/README.md (about a minute in DevTools)

# Telegram: put TG_API_ID/TG_API_HASH in the .env, then authorize
./skills/telegram-search/scripts/tg-search.sh --login
```

Everything mutable lives in `~/.config/search-skills/` (cookies, sessions,
rate-limit state, GraphQL template) — nothing secret is ever written into the
repo, and `.gitignore` blocks the obvious mistakes.

## Layout

```
skills/<name>/SKILL.md      agent-facing doc: commands + hard-won rules
skills/<name>/scripts/      the actual CLI, one concern per file
shared/chrome_cookies.py    export cookies for a host from the local Chrome (macOS Keychain)
examples/*.json             real, trimmed output of each skill
docs/shot.mjs               render a terminal transcript into a README screenshot
```

Each `SKILL.md` is written to be dropped into an agent harness (Claude Code /
pi / Cursor rules) as-is: the description line is the routing trigger, the body
is what the model needs to not repeat a mistake someone already paid for.

## Honest limits

* **These are your accounts.** Every request is logged against them; there is no
  anonymous mode. Keep volume human, or use a secondary account.
* **macOS-first.** Cookie export reads the Chrome Safe Storage Keychain entry and
  the Shopee cart bridge is an AppleScript applet. The Facebook and Telegram
  paths are plain Python and run anywhere.
* **Session, not scraper.** Shopee search needs a browser (the API requires a
  signature computed by page JS), Facebook needs a captured `doc_id`, Telegram
  needs a real login. All three break if you try to turn them into a crawler.
* **Things rotate.** Facebook's `doc_id` changes with client builds, Shopee
  changes its cart DOM; when something breaks, the fix is documented in the
  relevant `SKILL.md` rather than hidden in code.

## License

MIT — see [LICENSE](LICENSE).
