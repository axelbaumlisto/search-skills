"""Chợ Tốt / Nhà Tốt: публичный API без браузера."""
from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone

from ..models import Listing
from ..parse import parse_bedrooms, parse_price_vnd

API = "https://gateway.chotot.com/v1/public/ad-listing"


def parse(payload: dict) -> list[Listing]:
    out = []
    for a in payload.get("ads", []):
        if a.get("type") != "u":                      # u = cho thuê; s = bán
            continue
        text = a.get("body") or ""
        price = a.get("price") or parse_price_vnd(f"{a.get('price_string', '')} {a.get('subject', '')}")
        out.append(Listing(
            source="chotot", url=f"https://www.chotot.com/{a['list_id']}.htm", title=a.get("subject", ""),
            text=text, price_vnd=int(price) if price else None,
            bedrooms=a.get("rooms") or parse_bedrooms(f"{a.get('subject', '')} {text}"), kind="rent",
            lat=a.get("latitude"), lng=a.get("longitude"), area=a.get("ward_name") or a.get("area_name") or "",
            posted=datetime.fromtimestamp(a["list_time"] / 1000, timezone.utc) if a.get("list_time") else None,
            contact=a.get("account_name") or "", geo_bound=True))
    return out


def fetch(cfg, since=None) -> list[Listing]:
    c = cfg.chotot
    items: list[Listing] = []
    for cg in c.get("categories", [1000]):
        for offset in (0, 50):
            url = f"{API}?cg={cg}&area_v2={c['area_v2']}&limit=50&o={offset}"
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            items += parse(json.loads(urllib.request.urlopen(req, timeout=30).read()))
    return [x for x in items if not since or not x.posted or x.posted >= since]
