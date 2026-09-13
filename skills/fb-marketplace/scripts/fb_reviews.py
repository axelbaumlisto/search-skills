#!/usr/bin/env python3
"""Read Facebook Page reviews/recommendations over plain HTTP (no browser).

The www.facebook.com page renders reviews lazily, but `mbasic.facebook.com`
still ships them inside the initial HTML, so a single authenticated GET is
enough.

Usage:
    fb_reviews.py gachkinhdanang
    fb_reviews.py https://www.facebook.com/noithatbinhminhdanang
    fb_reviews.py gachkinhdanang --json

Finding the slug is deliberately NOT done here: /search/pages renders its
results with JS, so an HTTP fetch only ever returns unrelated people. Use
`browse.sh https://www.facebook.com/search/pages?q=...` (real browser) or a
`site:facebook.com` web search, then pass the slug in.
"""
from __future__ import annotations

import argparse
import html as H
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from fb_local import FbLocalError, _opener, _read  # noqa: E402

VN_HINT = re.compile(r"[àáâãèéêìíòóôõùúýăđĩũơư]", re.I)
RECO = re.compile(r"^(?P<who>.{2,60}?) (?:recommends|doesn't recommend|đề xuất) ", re.I)


def _slug(target: str) -> str:
    target = target.strip().rstrip("/")
    if target.startswith("http"):
        target = re.sub(r"^https?://[^/]+/", "", target)
    return target.split("/")[0].split("?")[0]


def _json_texts(raw: str) -> list[str]:
    out: list[str] = []
    for m in re.finditer(r'"text":"((?:[^"\\]|\\.){2,900})"', raw):
        try:
            t = json.loads('"' + m.group(1) + '"')
        except Exception:  # noqa: BLE001
            continue
        t = " ".join(H.unescape(t).split())
        if t:
            out.append(t)
    return list(dict.fromkeys(out))


def fetch_reviews(target: str) -> dict:
    slug = _slug(target)
    op = _opener()
    url = f"https://mbasic.facebook.com/{slug}/reviews"
    try:
        with op.open(url, timeout=40) as r:
            raw = _read(r)
    except Exception as exc:  # noqa: BLE001
        raise FbLocalError(f"cannot open {url}: {exc}") from exc

    title = re.search(r"<title[^>]*>(.*?)</title>", raw)
    name = H.unescape(title.group(1)) if title else slug
    if name.strip().lower() == "facebook":
        raise FbLocalError(f"page '{slug}' not reachable (wrong slug, or it has no reviews tab)")

    summary = re.search(r"(\d+)% recommend \((\d+) review", raw)
    texts = _json_texts(raw)

    authors, bodies = [], []
    for t in texts:
        m = RECO.match(t)
        if m:
            authors.append(m.group("who").strip())
            continue
        if len(t) < 15 or not VN_HINT.search(t):
            continue
        # skip the page's own marketing blurb and menu strings
        if re.search(r"(cung cấp các dòng|Chuyên Phân Phối|ĐC:|Phone/Zalo|Help )", t):
            continue
        bodies.append(t)

    reviews = [{"author": a, "text": b} for a, b in zip(authors, bodies)]
    if len(bodies) > len(authors):
        reviews += [{"author": None, "text": b} for b in bodies[len(authors):]]
    return {
        "page": name,
        "slug": slug,
        "url": f"https://www.facebook.com/{slug}",
        "recommend_pct": int(summary.group(1)) if summary else None,
        "review_count": int(summary.group(2)) if summary else None,
        "reviews": reviews,
    }


def main() -> int:
    p = argparse.ArgumentParser(description="Facebook Page reviews without a browser")
    p.add_argument("target", help="page slug or URL")
    p.add_argument("--json", action="store_true")
    a = p.parse_args()

    try:
        data = fetch_reviews(a.target)
    except FbLocalError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 3

    if a.json:
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0

    head = f"{data['page']} — {data['url']}"
    if data["recommend_pct"] is not None:
        head += f" | {data['recommend_pct']}% recommend ({data['review_count']} reviews)"
    print(head)
    if not data["reviews"]:
        print("  (no review texts in the static HTML — page may have ratings only)")
    for r in data["reviews"]:
        print(f"  • {r['author'] or '?'}: {r['text'][:300]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
