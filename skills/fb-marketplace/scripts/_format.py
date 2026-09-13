#!/usr/bin/env python3
"""Render fb_marketplace.py JSON (stdin) as compact human-readable lines."""
from __future__ import annotations

import json
import re
import sys

raw = sys.stdin.read().strip()
try:
    d = json.loads(raw)
except json.JSONDecodeError:
    print("not JSON on stdout:", raw[:300])
    sys.exit(1)

if d.get("error"):
    print("ERROR:", d["error"])
    sys.exit(1)

listings = d.get("listings")
if listings is None:  # detail payload
    print(json.dumps(d, ensure_ascii=False, indent=2)[:3000])
    sys.exit(0)

backend = d.get("backend", "?")
geo = d.get("geo_verified")
print(f"# query={d.get('query')!r} count={d.get('count')} backend={backend} geo_verified={geo}")
if backend == "dom":
    print("# warning: DOM backend — results follow the account location, not a city filter")
def price_label(raw: str | None) -> str:
    """Vietnamese sellers type '230' meaning 230 trieu, so the price field is
    routinely off by 3-6 orders of magnitude. Flag it instead of quoting it."""
    if not raw:
        return "no price"
    digits = re.sub(r"[^\d]", "", raw)
    if not digits:
        return raw
    val = int(digits)
    if raw.startswith("\u20ab") and val < 100_000:
        return f"{raw}?"          # implausible for VND: seller used shorthand
    return raw


for x in listings:
    title = " ".join((x.get("title") or "").split())[:110]
    print(f"  {price_label(x.get('price')):>14}  {title}")
    print(f"                  {x.get('url')}")
if any(price_label(x.get("price")).endswith("?") for x in listings):
    print("  # '?' = price field implausible (seller typed shorthand);"
          " read the real number in the title/description")
