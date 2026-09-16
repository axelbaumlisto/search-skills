---
name: marketplace-search
description: Search Facebook Marketplace for second-hand and new goods in Thailand and Vietnam cities (Bangkok, Phuket, Samui, Da Nang, HCMC, Hanoi and more), geo-scoped with price filters, pull details of a single listing, and read the reviews/recommendations of a Facebook business Page. Use when the user wants to buy/sell something locally, asks for used-item prices, "что есть на маркетплейсе", "поищи на фейсбуке", "барахолка", "second hand", "отзывы о компании/магазине", or needs the going rate for a product in a specific city.
compatibility: local HTTP path needs exported Facebook cookies; the browser fallback needs ssh to host `remote-browser` with chrome-cdp.service on :9222
---

# Facebook Marketplace search

Two paths, cheapest first:

1. **Local HTTP (default, ~5 s)** — `fb_local.py` replays the very same
   Marketplace GraphQL query the server skill uses, with exported cookies plus
   a freshly scraped `fb_dtsg`. No ssh, no shared browser.
2. **Remote browser (fallback)** — the logged-in Chrome on `remote-browser`
   (`chrome-cdp.service`, CDP :9222), used for `--detail` and whenever the HTTP
   path fails.

`fb-search.sh` picks automatically and says so on stderr when it falls back.

## Usage

```bash
S=~/.pi/agent/skills/marketplace-search/scripts

$S/fb-search.sh --health                                   # browser alive? logged in?
$S/fb-search.sh "sneakers 45" danang --limit 10
$S/fb-search.sh "giày" hcmc --min 300000 --max 3000000
$S/fb-search.sh "google pixel" --lat 9.5120 --lng 100.0136 --radius 25
$S/fb-search.sh --detail 28119410014412099                 # description, seller, location
$S/fb-search.sh "macbook" bangkok --raw                    # raw JSON
```

### Page reviews (no browser)

```bash
PY=~/work/tg_agent/naked/.venv/bin/python
$PY $S/fb_reviews.py gachkinhdanang                # slug or full URL
$PY $S/fb_reviews.py https://www.facebook.com/noithatbinhminhdanang --json
```

Prints `NN% recommend (N reviews)` and the review texts with authors. Works
because `mbasic.facebook.com/<slug>/reviews` still ships them in static HTML,
while `www` renders them lazily.

Finding the slug is *not* automated: `/search/pages` needs JS, and an HTTP
fetch of it returns unrelated people. Use
`~/.pi/agent/skills/browser-scout/scripts/browse.sh "https://www.facebook.com/search/pages?q=..."`
(it shows page names), or a `site:facebook.com` web search, then pass the slug.

Cities with presets: `bangkok pattaya phuket samui phangan chiangmai krabi`
(Thailand), `danang hcmc hanoi nhatrang hoian` (Vietnam). Anything else — pass
`--lat/--lng/--radius`.

Output: `price`, title, listing URL, plus a header with `backend` and
`geo_verified`.

## Reading the result honestly

| `backend` | Meaning |
|-----------|---------|
| `graphql` | true geo-scoped search with lat/lng/radius — trustworthy |
| `dom` | no geo was requested; results follow the *account* location, not the city the user asked about |
| `graphql-failed` | geo was requested but failed — the wrapper reports failure instead of showing wrong-city data |

Prices: `฿` baht, `₫` dong, `$` USD. Titles are seller-written — a title saying
"size 36-45" usually means the seller stocks a range, not that one pair fits
all; confirm with `--detail` before promising a size.

## Why the wrapper is not a plain ssh call

A foreground `ssh remote-browser python3 fb_marketplace.py …` gets cut off ("Command
aborted") while the remote process keeps running and holds the browser. The
wrapper starts the job with `nohup`, polls for output, prints it, cleans up temp
files, and kills the remote process on timeout. Raise the budget with
`--wait 300` for slow queries.

## Hard limits (read before promising anything)

| Constraint | Reality |
|---|---|
| Whose account | requests run under the **owner's personal Facebook account** — there is no anonymous mode |
| Where it runs | on the machine whose cookies are installed; cookies and IP must belong together |
| Cookie store | `~/work/tg_agent/naked/.secrets/cookies/facebook.cookies.txt`, mode 600, kept **locally**, exported from the local Chrome |
| Cookie lifetime | dies on logout/password change/Meta invalidation — no auto-refresh, re-run `fb-cookies.sh refresh` by hand |
| Pace | ≥4 s + jitter between requests, **40 requests/hour**, enforced in code |
| Volume | fine for "find me N listings"; not a bulk scraper and must not become one |
| `--detail` | needs the remote browser on remote-browser; serialised by `flock`, ~45–60 s |
| Page reviews | only what `mbasic` ships statically — usually the 3–5 newest, not the full list |
| `doc_id` | rotates whenever Meta ships a client build; then re-copy the template from remote-browser |
| Anonymity | none: viewing is invisible to sellers, but every request is logged against the account |

## Cookie store

```bash
S=~/.pi/agent/skills/marketplace-search/scripts
$S/fb-cookies.sh              # age, cookie names, is the session alive, hourly budget
$S/fb-cookies.sh refresh      # re-export from local Chrome (Default profile)
$S/fb-cookies.sh refresh "Profile 1"
```

`refresh` also drops the cached `fb_dtsg`, since a token from the previous
session is useless. Import again whenever `status` says DEAD, after a Facebook
password change, or when searches start returning `error`.

## Not getting the account flagged

The HTTP path is automation on a real personal account, so it is paced on
purpose. Guard rails baked into `fb_local.py`:

| Guard | Value | Why |
|-------|-------|-----|
| min interval + jitter | 4 s + up to 3 s random | community-reported blocks start near 10-20 req/min from one address |
| hourly budget | 40 requests, persisted in `~/.naked/fb_local_state.json` | refuses to continue instead of drifting into a block |
| `fb_dtsg` cache | 20 min | one search = one GraphQL call instead of also pulling a 2 MB page |
| flag detection | `/checkpoint/`, `1357004`, `1390008`, "We limit how often", "You Can't Use This Feature Right Now" | exits **4** and tells the caller to stop |

**On exit code 4 (`"blocked": true`) never retry, never switch host, never
re-login.** Open Facebook manually in the remote-browser browser
(`https://YOUR-HOST/vnc`), clear the checkpoint by hand, then leave the
account idle. Automated retries during a live flag deepen it; repeated
login/logout and IP hopping are exactly what the risk scorer punishes.

### One session, one IP — requests must leave from where the session lives

Meta's risk scoring treats "same cookies, new distant IP" as session hijacking.
So the rule is: **whoever owns the cookies runs the request.**

Preferred setup (current): cookies exported from the **local** Chrome, requests
sent from this machine — the same box and residential IP the human actually
browses Facebook from.

```bash
PY=~/work/tg_agent/naked/.venv/bin/python
$PY scripts/chrome_cookies.py facebook.com \
   --out ~/work/tg_agent/naked/.secrets/cookies/facebook.cookies.txt
```

`chrome_cookies.py` decrypts the macOS Chrome cookie DB (AES-128-CBC, key from
the `Chrome Safe Storage` Keychain entry) and writes Netscape format. It warns
if `c_user`/`xs` are missing, i.e. that profile is not logged in.

`fb-search.sh` then picks the execution host **automatically** by looking at the
cookie file header: locally exported cookies → run here; cookies dumped from the
remote-browser browser → run on remote-browser. Override with `FB_LOCAL_SESSION=0/1`.

Latency, measured: local residential IP ≈ 2–9 s per search; from remote-browser (Hetzner)
≈ 60 s, and the browser path from that host is just as slow — that is
Hetzner↔Meta distance, not our throttling.

## Why HTTP 400 happens (headers, not IP)

Facebook answers **400** to requests that look almost-but-not-quite like Chrome.
The full client-hint set (`sec-ch-ua`, `sec-ch-ua-platform`, `Sec-Fetch-*`,
`Upgrade-Insecure-Requests`, gzip) is mandatory — already baked into
`fb_local.BROWSER_HEADERS`. Not an IP problem: a bare request fails from `remote-browser`
too.

The GraphQL template (`doc_id` + variables) is cached at
`~/.naked/fb_marketplace_graphql.json`. If Meta ships a new client build the
`doc_id` rotates and the fast path starts returning GraphQL errors — re-copy the
file from `remote-browser`, where the browser harvests it automatically:

```bash
scp remote-browser:.naked/fb_marketplace_graphql.json ~/.naked/fb_marketplace_graphql.json
```

## When it breaks

| Symptom | Fix |
|---------|-----|
| `--health` shows inactive | `ssh remote-browser 'systemctl --user restart chrome-cdp.service'` |
| empty result, stderr mentions login/checkpoint | the user must sign into Facebook once at `https://YOUR-HOST/vnc` |
| exit code 3 / `graphql-failed` | retry; do not treat as "nothing found" |
| a `--detail` answer that belongs to another listing | two browser jobs ran at once; the wrappers now serialise on `/tmp/fb-browser.lock`, so re-run and check the returned `item_id` matches what you asked for |
| unknown city | use `--lat/--lng`, or add the preset in the underlying skill |

Underlying server-side skill (also has group search):
`remote-browser:~/work/tg_agent/naked/skills/facebook-marketplace/scripts/fb_marketplace.py`.
Local mirror of the docs: `~/work/tg_agent/naked/skills/facebook-marketplace/SKILL.md`.

For classifieds inside Telegram use `telegram-search`; for the physical shop
behind a listing use `google-places`; for other blocked sites use
`browser-scout`.
