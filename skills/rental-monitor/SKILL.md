---
name: rental-monitor
description: Monitor long-term rental listings in Vietnam (Chợ Tốt/Nhà Tốt, Facebook Marketplace, Telegram expat chats, muaban.net), keep only new ones matching budget/bedrooms/city, append them to a markdown log and send them to a Telegram contact. Use when the user wants to find a house/apartment for rent and keep watching for fresh offers — "найди дом в аренду", "следи за объявлениями", "присылай свежие варианты", "мониторинг аренды", Phu Quoc / Da Nang rentals.
compatibility: uv; an ssh host with a logged-in Chrome on CDP :9222 and the fb-marketplace skill (Facebook, muaban); authorized Telethon sessions and TG_API_ID/TG_API_HASH (env, env_file in the config, or ~/.config/search-skills/.env)
---

# Rental monitor

One command runs the whole pass: collect → drop already seen → check criteria →
append to the log file → send new matches to the recipient. No agent involved.

## Usage

```bash
S=~/.pi/agent/skills/rental-monitor
uv run --project $S rental-monitor check   --config my-search.toml   # every source alive?
uv run --project $S rental-monitor refresh --config my-search.toml --dry-run   # show, change nothing
uv run --project $S rental-monitor refresh --config my-search.toml             # real pass (sends)
uv run --project $S rental-monitor refresh --config ... --no-send                       # log only
uv run --project $S rental-monitor seed    --config ... --from old_report.md            # mark URLs as seen
uv run --project $S pytest -q                                                            # tests (offline)
```

## New search = new config

Everything search-specific lives in one TOML: city keywords, excluded cities,
price range, min bedrooms, center point for distances, per-source settings,
recipient `notify.peer_id`, state file and markdown log (relative paths resolve
next to the config). Start from `configs/example.toml`, keep your copy **outside
the repo** (it holds session paths and a recipient), run `seed` with any earlier
report so old listings are not resent.

## What gets sent

Only listings with a known price inside `[min_price_vnd, max_price_vnd]`, known
bedrooms ≥ `min_bedrooms`, not daily/homestay, not another city, and never sent
before. Nothing new → nothing is sent; the log still gets a line with counts.

Message format — no internal fields (no "?", no province, no unknown distance):
`N) 9 млн/мес · 2 спальни · <title without emoji> · <district if specific>`, then links:
posts from a group/chat → group link first ("вступить, чтобы открыть пост"), post link
under it; Facebook Marketplace → one link marked "нужен вход в Facebook"
(Marketplace items are not group posts — there is no group to join).

## Sources

| Source | How | Notes |
|---|---|---|
| chotot | public API `gateway.chotot.com`, `area_v2` | rent = `type u`; small volume in Phu Quoc |
| facebook | `fb_marketplace.py` on the ssh host, geo search | geo leaks other cities → `exclude_keywords`; card details for up to `max_details` items |
| telegram | Telethon `SearchGlobalRequest` from the research session | only chats with a public username (link needed) |
| muaban | Playwright on the ssh host's Chrome | province page, filtered by city keywords |

A failing source is reported in the stats line and does not stop the others.
Remote browser jobs are serialised with `/tmp/fb-browser.lock` (shared with
the marketplace-search / browser-scout skills).

## Schedule

Any scheduler that runs a command. macOS launchd, every 6 h:

```xml
<key>ProgramArguments</key><array>
  <string>/path/to/uv</string><string>run</string><string>--project</string><string>/path/to/skills/rental-monitor</string>
  <string>rental-monitor</string><string>refresh</string><string>--config</string><string>/path/to/my-search.toml</string>
</array>
<key>StartInterval</key><integer>21600</integer>
<key>StandardOutPath</key><string>/path/to/rental-monitor.log</string>
```
Load: `launchctl bootstrap gui/$(id -u) <plist>`; stop: `launchctl bootout gui/$(id -u)/<label>`.
Linux: `0 */6 * * * uv run --project ... rental-monitor refresh --config ...` in crontab.

## Config reference (`configs/*.toml`)

| Key | Meaning |
|---|---|
| `env_file` | optional file with TG_API_ID/TG_API_HASH, loaded with the config |
| `name` | label in messages ("Фукуок — свежие варианты …") |
| `min_price_vnd`, `max_price_vnd` | monthly price window; below min = nightly price or junk |
| `min_bedrooms` | listings with unknown bedrooms are never sent |
| `city_keywords` | required in text for sources that are not geo-bound (Telegram, muaban) |
| `exclude_keywords` | other cities; Facebook geo search leaks them |
| `[center]` `label/lat/lng` | point for "~N км до …" |
| `[chotot]` `area_v2`, `categories` | Chợ Tốt district code (Phú Quốc = 503112) |
| `[facebook]` `queries`, `lat/lng/radius_km`, `limit`, `max_details`, `remote_host`, `remote_script` | geo search on the ssh host; `max_details` = card reads per run (~45 s each) |
| `[telegram]` `session`, `queries` | research account session; short query stems work best |
| `[muaban]` `urls`, `remote_host` | province rental pages |
| `[notify]` `session`, `peer_id` | who receives new matches (personal account) |
| `[paths]` `state`, `master` | seen/sent JSON and the markdown log |

A section left out of the config disables that source.

## Adding a source

1. `src/rental_monitor/sources/<name>.py` with a pure `parse(raw) -> list[Listing]`
   and a network `fetch(cfg, since) -> list[Listing]`; optional
   `enrich(cfg, items) -> list[Listing]` for extra per-item reads.
2. Register it in `sources/__init__.py` (`REGISTRY`), add a `[<name>]` config section.
3. Save a real response to `tests/fixtures/` and write the `parse` test first.
Pipeline and CLI need no changes.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `facebook: ошибка … blocked` | FB checkpoint — stop, clear it by hand in the ssh host's browser (VNC), do not retry |
| `facebook` returns only `RUNNING` / empty | wrong `remote_script` path on the host |
| `telegram: ошибка … not authorized` | session expired — log in again with Telethon for that session file |
| `muaban: 0` | page layout changed — check `REMOTE_SCRIPT` selector in `sources/muaban.py` |
| same listing sent twice | its URL changed; `state.json` keys on URL |
| scheduled run did nothing | read its log; `launchctl print gui/$(id -u)/<label>` shows last exit code |

## Layout

```
src/rental_monitor/
  models.py     Listing — one shape for every source
  parse.py      price / bedrooms / "offer vs request" / daily-rental detection from free text
  geo.py        haversine + approximate district coordinates
  config.py     TOML -> Config
  filters.py    matches(listing, cfg) -> (ok, reason)
  store.py      State: seen / sent / last_run (JSON)
  report.py     markdown section + Telegram message
  pipeline.py   refresh(): collect -> new -> enrich -> filter -> log -> send
  sources/      __init__ (REGISTRY) · chotot · facebook · telegram · muaban
  remote.py     detached ssh jobs with flock on the shared browser
  tg.py         Telethon client, TG_API_ID/HASH from env / env_file / ~/.config/search-skills/.env
  notify.py     send message to cfg.notify.peer_id
  cli.py        refresh | check | seed
tests/          offline tests on saved real responses (tests/fixtures/)
configs/        one TOML per search
```
