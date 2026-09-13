---
name: fb-marketplace
description: Search Facebook Marketplace for second-hand and new goods in Thailand and Vietnam cities (Bangkok, Phuket, Samui, Da Nang, HCMC, Hanoi and more), geo-scoped with price filters, and read the reviews/recommendations of a Facebook business Page. Use when the user wants to buy/sell something locally, asks for used-item prices, "что есть на маркетплейсе", "поищи на фейсбуке", "барахолка", "second hand", "отзывы о компании/магазине", or needs the going rate for a product in a specific city.
compatibility: needs Facebook cookies exported from a local Chrome; pure HTTP, no browser at runtime
---

# Facebook Marketplace search

One path: `fb_local.py` replays the very same Marketplace GraphQL query the page
makes, using exported cookies plus a freshly scraped `fb_dtsg`. One HTTPS request,
about 5 s, no browser and no ssh at runtime.

## Usage

```bash
S=<repo>/skills/fb-marketplace/scripts   # ./scripts relative to this SKILL.md

$S/fb-search.sh --health                                   # session alive? budget left?
$S/fb-search.sh "sneakers 45" danang --limit 10
$S/fb-search.sh "giày" hcmc --min 300000 --max 3000000
$S/fb-search.sh "google pixel" --lat 9.5120 --lng 100.0136 --radius 25
$S/fb-search.sh "macbook" bangkok --raw                    # raw JSON
```

### Page reviews (no browser)

```bash
python3 $S/fb_reviews.py <page-slug>           # slug or full URL
python3 $S/fb_reviews.py https://www.facebook.com/<page-slug> --json
```

Prints `NN% recommend (N reviews)` and the review texts with authors. Works
because `mbasic.facebook.com/<slug>/reviews` still ships them in static HTML,
while `www` renders them lazily.

Finding the slug is *not* automated: `/search/pages` needs JS, and an HTTP
fetch of it returns unrelated people. Use
a real browser on `https://www.facebook.com/search/pages?q=...` or a
`site:facebook.com` web search, then pass the slug.

Cities with presets (the wrapper reads the list from `fb_graphql.CITY_COORDS`, so
the two can never drift): `bangkok pattaya phuket samui koh-samui phangan
chiangmai krabi` (Thailand), `danang hcmc saigon hanoi nhatrang hoian` (Vietnam).
Anything else — pass `--lat/--lng/--radius`.

Output: `price`, title, listing URL, plus a header with `backend` and
`geo_verified`.

## Reading the result honestly

| field | Meaning |
|-------|---------|
| `backend: graphql-local` | the only value this repo emits — a real GraphQL search |
| `geo_verified: true` | a city or lat/lng was applied; the listings are from there |
| `geo_verified: false` | no geo was requested — results follow the **account** location, not a city |
| `error` + non-zero exit | nothing is printed rather than wrong-city data |

Prices: `฿` baht, `₫` dong, `$` USD. Titles are seller-written — a title saying
"size 36-45" usually means the seller stocks a range, not that one pair fits
all; ask the seller before promising a size.

## Exit codes

`0` ok · `2` usage error · `3` session or template problem · `4` **Facebook flagged the
account — stop, do not retry**. The wrapper never prints listings on a non-zero exit.

## Hard limits (read before promising anything)

| Constraint | Reality |
|---|---|
| Whose account | requests run under the **owner's personal Facebook account** — there is no anonymous mode |
| Where it runs | on the machine whose cookies are installed; cookies and IP must belong together |
| Cookie store | `~/.config/search-skills/facebook.cookies.txt`, mode 600, exported from the local Chrome (`$FB_COOKIES` overrides) |
| Cookie lifetime | dies on logout/password change/Meta invalidation — no auto-refresh, re-run `fb-cookies.sh refresh` by hand |
| Pace | ≥4 s + jitter between requests, **40 requests/hour**, enforced in code |
| Volume | fine for "find me N listings"; not a bulk scraper and must not become one |
| Page reviews | only what `mbasic` ships statically — usually the 3–5 newest, not the full list |
| `doc_id` | rotates whenever Meta ships a client build; then re-capture the template (see `templates/README.md`) |
| Anonymity | none: viewing is invisible to sellers, but every request is logged against the account |

## Cookie store

```bash
S=<repo>/skills/fb-marketplace/scripts   # ./scripts relative to this SKILL.md
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
| hourly budget | 40 requests, persisted in `~/.config/search-skills/fb_local_state.json` | refuses to continue instead of drifting into a block |
| `fb_dtsg` cache | 20 min | one search = one GraphQL call instead of also pulling a 2 MB page |
| flag detection | `/checkpoint/`, `1357004`, `1390008`, "We limit how often", "You Can't Use This Feature Right Now" | exits **4** and tells the caller to stop |

**On exit code 4 (`"blocked": true`) never retry, never switch host, never
re-login.** Open Facebook by hand in the browser that owns the session, clear
the checkpoint, then leave the account idle. Automated retries during a live flag deepen it; repeated
login/logout and IP hopping are exactly what the risk scorer punishes.

### One session, one IP — requests must leave from where the session lives

Meta's risk scoring treats "same cookies, new distant IP" as session hijacking,
so the rule is: **whoever owns the cookies runs the request.** Default setup:
cookies exported from the local Chrome, requests sent from the same machine and
residential IP the human actually browses Facebook from. If you instead keep the
session on a server, export the cookies there and run the query there.

Measured latency: residential IP ≈ 2–9 s per search; a datacenter IP is faster
but far more likely to trip a checkpoint.

## Why a bare HTTP request fails

Facebook answers `400` to "nearly-browser" requests: the full Chrome client-hint
and `Sec-Fetch` set is mandatory, not decorative — see `fb_local.BROWSER_HEADERS`.
Not an IP problem; a bare request fails from every host.

## When `doc_id` rotates

`fb_local.py` replays one captured GraphQL request stored in
`~/.config/search-skills/fb_marketplace_graphql.json`. When Meta ships a new
client build the old `doc_id` starts returning errors — re-capture it, see
`skills/fb-marketplace/templates/README.md` (about a minute in DevTools).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `error` in JSON, session says DEAD | `fb-cookies.sh refresh` |
| results from the wrong city | you passed no city and no `--lat/--lng`; the account location was used |
| exit code 4, `"blocked": true` | stop everything, clear the checkpoint by hand, idle the account |
| `no GraphQL template` | capture it once, see `templates/README.md` |
| empty result on a query that clearly has listings | the template is stale — re-capture |
