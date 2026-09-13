#!/usr/bin/env python3
"""Marketplace GraphQL plumbing: city presets, variable merging, edge parsing.

Extracted so the HTTP path has no dependency on a browser driver. The shapes here
mirror what Facebook actually returns; every guard in `parse_edges` exists because
a real response violated the obvious assumption at least once.
"""
from __future__ import annotations

import copy
import json

CITY_COORDS = {
  # Vietnam
  "danang":    (16.0544, 108.2022),   # protects fb-danang-iphone-smoke brief
  "hcmc":      (10.7769, 106.7009),
  "saigon":    (10.7769, 106.7009),
  "hanoi":     (21.0278, 105.8342),
  "nhatrang":  (12.2388, 109.1967),
  "hoian":     (15.8801, 108.3380),
  # Thailand
  "bangkok":   (13.7563, 100.5018),
  "samui":     (9.5120, 100.0136),
  "koh-samui": (9.5120, 100.0136),
  "kosamui":   (9.5120, 100.0136),
  "pattaya":   (12.9236, 100.8825),
  "phuket":    (7.8804, 98.3923),
  "chiangmai": (18.7883, 98.9853),
  "krabi":     (8.0863, 98.9063),
  "phangan":   (9.7319, 100.0136),
  "koh-phangan": (9.7319, 100.0136),
}
# Region substrings used to FILTER out FB's nationwide padding (case-insensitive).
# FB tags listings by province/city text (reverse_geocode.city_page.display_name).
REGION_HINTS = {
  # Vietnam
  "danang": ["Da Nang", "Đà Nẵng"],
  "hcmc": ["Ho Chi Minh", "Hồ Chí Minh", "Saigon"],
  "saigon": ["Ho Chi Minh", "Hồ Chí Minh", "Saigon"],
  "hanoi": ["Hanoi", "Hà Nội"],
  "nhatrang": ["Nha Trang", "Khanh Hoa", "Khánh Hòa"],
  "hoian": ["Hoi An", "Hội An", "Quang Nam", "Quảng Nam"],
  # Thailand
  "bangkok": ["Bangkok", "Krung Thep", "Nonthaburi", "Samut Prakan"],
  "samui": ["Surat Thani", "Ko Samui", "Samui", "Pha-ngan"],
  "koh-samui": ["Surat Thani", "Ko Samui", "Samui", "Pha-ngan"],
  "kosamui": ["Surat Thani", "Ko Samui", "Samui", "Pha-ngan"],
  "pattaya": ["Pattaya", "Chon Buri", "Chonburi", "Bang Lamung"],
  "phuket": ["Phuket"],
  "chiangmai": ["Chiang Mai"],
  "krabi": ["Krabi"],
  "phangan": ["Pha-ngan", "Phangan", "Surat Thani"],
  "koh-phangan": ["Pha-ngan", "Phangan", "Surat Thani"],
}


def _clean(s: str) -> str:
    """Decode FB's unicode escapes including surrogate pairs."""
    if not s:
        return ""
    s = s.replace("\\/", "/")
    # Decode FB JSON-string escapes without mojibake on already-decoded UTF-8.
    try:
        s = json.loads(f'"{s}"')
    except Exception:
        pass
    # Fix surrogate pairs (emoji) and strip bad chars
    s = s.encode("utf-16", "surrogatepass").decode("utf-16", "replace")
    s = s.encode("utf-8", "replace").decode("utf-8")
    return s.strip()


def build_listing(item_id, title, price) -> dict:
    return {
        "item_id": item_id,
        "title": _clean(title),
        "price": _clean(price) if price else None,
        "url": f"https://www.facebook.com/marketplace/item/{item_id}/",
    }


def _variables_container(template: dict) -> dict:
    if isinstance(template.get("variables"), dict):
        return template["variables"]
    return template


def merge_variables(
    template: dict,
    *,
    query,
    lat,
    lng,
    radius_km,
    min_price,
    max_price,
    days,
    shipping,
    count=24,
) -> dict:
    """Deep-copy a captured variables template and inject replay parameters.

    The real captured shape is the variables object itself, but pagination
    captures may wrap it as {"variables": {...}}; both are accepted. Any
    top-level cursor on the variables object is stripped so replay starts at
    page 1 rather than a stale pagination page.
    """
    merged = copy.deepcopy(template)
    variables = _variables_container(merged)
    variables.pop("cursor", None)
    variables["count"] = count

    params = variables.setdefault("params", {})
    bqf = params.setdefault("bqf", {})
    bqf["query"] = query

    browse_params = params.setdefault("browse_request_params", {})
    browse_params["filter_location_latitude"] = lat
    browse_params["filter_location_longitude"] = lng
    browse_params["filter_radius_km"] = radius_km
    browse_params["commerce_enable_shipping"] = shipping
    # S4 live finding: FB rejects null price bounds / ctime with a degraded
    # 1-result response (wrong region). Only override when the caller supplies
    # an explicit value; otherwise KEEP the captured template's defaults
    # (e.g. lower=0, upper=214748364700), which FB accepts.
    if min_price is not None:
        browse_params["filter_price_lower_bound"] = min_price
    if max_price is not None:
        browse_params["filter_price_upper_bound"] = max_price
    if days is not None:
        browse_params["commerce_search_and_rp_ctime_days"] = days
    return merged


def _nested(obj, *keys):
    cur = obj
    for key in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


def _coerce_float(value):
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _listing_location(listing: dict):
    location = listing.get("location") if isinstance(listing, dict) else None
    reverse = location.get("reverse_geocode") if isinstance(location, dict) else None
    display = None
    if isinstance(reverse, dict):
        display = _nested(reverse, "city_page", "display_name") or reverse.get("city")
        # Fixtures document the preferred coordinate shape: first-party
        # reverse_geocode latitude/longitude when present, otherwise the
        # listing.location latitude/longitude fallback below.
        lat = _coerce_float(reverse.get("latitude"))
        lng = _coerce_float(reverse.get("longitude"))
    else:
        lat = None
        lng = None
    if isinstance(location, dict):
        lat = lat if lat is not None else _coerce_float(location.get("latitude"))
        lng = lng if lng is not None else _coerce_float(location.get("longitude"))
    return display, lat, lng


def parse_edges(response_json: dict) -> list[dict]:
    """Parse Marketplace GraphQL edges into listing dicts.

    Malformed edges are skipped. Coordinates, when exposed, are stored as
    additive top-level `lat`/`lng` fields while `location` remains the display
    string used by downstream consumers.
    """
    edges = _nested(response_json, "data", "marketplace_search", "feed_units", "edges")
    if not isinstance(edges, list):
        return []

    listings = []
    for edge in edges:
        listing = _nested(edge, "node", "listing")
        if not isinstance(listing, dict):
            continue
        item_id = listing.get("id")
        title = listing.get("marketplace_listing_title")
        if not item_id or not title:
            continue
        price = _nested(listing, "listing_price", "formatted_amount")
        location, lat, lng = _listing_location(listing)
        parsed = build_listing(str(item_id), title, price)
        parsed["location"] = _clean(location) if location else None
        if lat is not None and lng is not None:
            parsed["lat"] = lat
            parsed["lng"] = lng
        listings.append(parsed)
    return listings


def filter_region(listings, hints) -> list[dict]:
    """Keep only listings whose FB location string matches a region hint."""
    if not hints:
        return []
    normalized_hints = [str(hint).strip().lower() for hint in hints if str(hint).strip()]
    if not normalized_hints:
        return []

    filtered = []
    for listing in listings:
        region = listing.get("location") if isinstance(listing, dict) else None
        if not isinstance(region, str) or not region.strip():
            continue
        region_lower = region.lower()
        if any(hint in region_lower for hint in normalized_hints):
            filtered.append(listing)
    return filtered

