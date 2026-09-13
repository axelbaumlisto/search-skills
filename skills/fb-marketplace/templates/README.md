# Capturing the Marketplace GraphQL template

`fb_local.py` replays the very same GraphQL request the Marketplace page makes.
Facebook rotates the `doc_id` and expects a coherent `variables` blob, so the
template is captured once from your own browser and refreshed when search starts
failing (typically every few months).

The captured file is **account-specific** — it embeds a pagination cursor and
the session's `doc_id`. It lives outside the repo and is git-ignored:
`~/.config/search-skills/fb_marketplace_graphql.json` (override with `$FB_TEMPLATE`).

## Procedure (about a minute)

1. Open <https://www.facebook.com/marketplace/> in the Chrome you are logged into.
2. DevTools → Network → filter `graphql`.
3. Search for anything and scroll once, so a pagination request fires.
4. Find the request whose payload contains
   `fb_api_req_friendly_name=CometMarketplaceSearchContentPaginationQuery`.
5. Copy `doc_id` and the whole decoded `variables` JSON.
6. Write the file:

```json
{
  "captured_at": "2026-01-01T00:00:00+00:00",
  "doc_id": "<doc_id from the request>",
  "friendly_name": "CometMarketplaceSearchContentPaginationQuery",
  "variables_template": { "...": "the decoded variables object" }
}
```

`fb_local.py` overwrites the query, location, radius, price bounds and count;
everything else is passed through unchanged. A stale template shows up as
`no results` or an `error` field in the JSON output — re-capture and retry.
