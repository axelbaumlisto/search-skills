---
name: google-places
description: Find real-world places via Google Places API (New) — shops, cafes, restaurants, services — with ratings, review counts, address, coordinates, phone, opening hours and website. Use when the user asks where to buy something, wants nearby stores, asks about a venue's rating/hours/phone, needs a shortlist of local businesses in a city, or asks to compare competitors by rating. Also tracks API quota spend.
compatibility: needs a gmaps-places checkout with venv and GOOGLE_API_KEY; set PLACES_HOME/PLACES_ENV when auto-discovery is not enough.
---

# Google Places search

Thin wrapper over the naked `gmaps-places` skill. Returns real Places data, not
web-scraped guesses.

## Usage

```bash
S=~/.pi/agent/skills/google-places/scripts

$S/places.sh "sneaker store Da Nang" --limit 5
$S/places.sh "cafe" --near 16.0545,108.2022 --radius 3000 --limit 10
$S/places.sh "giày thể thao" --type shoe_store --lang vi
$S/places.sh --details ChIJ5RyeqbgZQjERlsBq0A9QNzo    # phone, hours, website, maps link
$S/places.sh --budget                                 # quota counter for the month
$S/places.sh "..." --raw                              # raw JSON
```

Output: name, rating with review count, address, coordinates, phone,
`place_id`, and for `--details` also opening hours and the Google Maps link.

## How to use it well

- The query is **positional**. `--query` / `--text` are not accepted and the
  CLI exits 2.
- Text search already understands city names ("shoe store Da Nang"). Use
  `--near LAT,LNG --radius M` when the user cares about walking distance from a
  specific point.
- Rating alone is misleading in Vietnam/Thailand — always read the review
  **count** next to it: `5★ (237)` beats `5★ (3)`.
- Two-step flow for anything actionable: `search` to shortlist, then
  `--details <place_id>` for phone and opening hours before telling the user to
  go there.
- Places API calls cost money: shortlist with one search, then pull details
  only for the 1–3 candidates that matter. `--budget` shows the running count.
- `place_id` values are stable — pass them around instead of re-searching.

## Combining with other search skills

- Physical shop found here, but need current price/stock → `telegram-search`
  (classifieds channels) or `marketplace-search` (Facebook).
- Need reviews text, menu or promotions → open the shop's website/Facebook page
  with `browser-scout`.
- Broad multi-source hunt → see the `search-agent` skill for the recipe.

Underlying implementation and budget file:
the external `gmaps-places` runtime selected by `PLACES_HOME`.
