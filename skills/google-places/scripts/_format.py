#!/usr/bin/env python3
"""Render gmaps_cli.py JSON (stdin) as compact human-readable lines."""
import json
import sys

d = json.load(sys.stdin)
if not d.get("success", True):
    print("ERROR:", d.get("error"))
    sys.exit(1)

places = d.get("places")
if places is None and "place" in d:
    places = [d["place"]]

if places is None:  # budget / unknown shape
    print(json.dumps(d, ensure_ascii=False, indent=2))
    sys.exit(0)

def pick(p, *keys, default=None):
    """details returns camelCase Places fields, search returns snake_case ones."""
    for k in keys:
        v = p.get(k)
        if v not in (None, "", [], {}):
            return v
    return default


for p in places:
    name = pick(p, "name", "displayName", "display_name")
    if isinstance(name, dict):
        name = name.get("text")
    rating = pick(p, "rating")
    votes = pick(p, "user_rating_count", "userRatingCount")
    if rating:
        score = f"{rating}★ ({votes})" if votes else f"{rating}★"
    else:
        score = "no rating"
    print(f"{name or '(no name)'} — {score}")
    addr = pick(p, "address", "formattedAddress", "formatted_address")
    if addr:
        print(f"  {addr}")
    bits = []
    loc = pick(p, "location", default={})
    if loc.get("latitude") is not None:
        bits.append(f"{loc['latitude']:.5f},{loc['longitude']:.5f}")
    phone = pick(p, "nationalPhoneNumber", "national_phone_number", "phone")
    if phone:
        bits.append(phone)
    site = pick(p, "websiteUri", "website")
    if site:
        bits.append(str(site)[:80])
    if bits:
        print("  " + " | ".join(bits))
    hours = pick(p, "regularOpeningHours", "opening_hours", default={})
    descr = hours.get("weekdayDescriptions") if isinstance(hours, dict) else None
    if descr:
        print("  hours: " + "; ".join(d for d in descr[:7]))
    maps = pick(p, "googleMapsUri")
    if maps:
        print(f"  {str(maps).split('&g_mp=')[0]}")
    if p.get("id"):
        print(f"  place_id={p['id']}")

    # details returns up to 5 reviews; they are the whole point of asking
    for r in (p.get("reviews") or [])[:5]:
        stars = r.get("rating")
        when = (r.get("relativePublishTimeDescription")
                or (r.get("publishTime") or "")[:10])
        author = (r.get("authorAttribution") or {}).get("displayName", "?")
        text = (r.get("originalText") or r.get("text") or {})
        body = " ".join((text.get("text") or "").split())
        print(f"  {stars}★ {author} ({when}): {body[:400] or '(no text, rating only)'}")
