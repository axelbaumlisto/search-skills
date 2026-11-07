#!/usr/bin/env python3
"""HomePro search -> Thai/English name, live price and product URL.

HomePro started returning HTTP 403 for /search?q= in late 2026. Its official search
suggestion endpoint is still public and returns structured current/original prices,
product IDs and both names, so use that first. The old SSR parser remains as a fallback
for installations where /search still works.
"""
import json
import re
import sys
import html
import subprocess
import urllib.parse

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
BASE = "https://www.homepro.co.th"


def curl(url: str) -> tuple[int, str]:
    p = subprocess.run(
        ["curl", "-sS", "--max-time", "30", "-A", UA, "-w", "\n%{http_code}", url],
        capture_output=True, text=True,
    )
    body, _, code = p.stdout.rpartition("\n")
    return int(code or 0), body


def number(s: str) -> float | None:
    m = re.search(r"[\d,]+(?:\.\d+)?", html.unescape(str(s or "")))
    return float(m.group().replace(",", "")) if m else None


def parse_suggest(body: str) -> list[dict]:
    data = json.loads(body)
    out = []
    for it in data.get("items") or []:
        pid = str(it.get("partnumber") or "").strip()
        if not pid:
            continue
        prices = [number(x) for x in re.findall(r'class="(?:normal|reduced)-price"[^>]*>(.*?)</span>', it.get("price_display") or "", re.S)]
        prices = [x for x in prices if x is not None]
        # A reduced-price card contains old then current price. A normal card has one.
        current = prices[-1] if prices else number(it.get("price_display"))
        original = prices[0] if len(prices) > 1 else None
        out.append({
            "id": pid,
            "name": html.unescape(it.get("item_name") or "").strip(),
            "name_en": html.unescape(it.get("item_name_en") or "").strip(),
            "price": current,
            "original_price": original,
            "brand": it.get("brand") or None,
            "url": f"{BASE}/p/{pid}",
        })
    return out


def parse_ssr(body: str) -> list[dict]:
    ids = re.findall(r'id="gtmName-(\d+)"', body)
    out = []
    for pid in dict.fromkeys(ids):
        def gt(field):
            m = re.search(rf'id="gtm{field}-{pid}"\s+value="([^"]*)"', body)
            return html.unescape(m.group(1)) if m else ""
        out.append({
            "id": pid, "name": gt("Name"), "name_en": gt("NameEN"),
            "price": number(gt("NetPrice")) or number(gt("Price")),
            "original_price": number(gt("Price")), "brand": None,
            "url": f"{BASE}/p/{pid}",
        })
    return out


def fetch(q: str) -> tuple[list[dict], str]:
    quoted = urllib.parse.quote(q)
    suggest_code, body = curl(f"{BASE}/service/search/suggest.jsp?q={quoted}")
    if suggest_code == 200:
        try:
            rows = parse_suggest(body)
            if rows:
                return rows, "official-suggest"
            # Structured 200 + empty items is a real empty result, not a transport failure.
            if isinstance(json.loads(body).get("items"), list):
                return [], "official-suggest"
        except (json.JSONDecodeError, TypeError, ValueError):
            pass
    ssr_code, body = curl(f"{BASE}/search?q={quoted}")
    rows = parse_ssr(body) if ssr_code == 200 else []
    if rows:
        return rows, "ssr"
    raise RuntimeError(f"HomePro search unavailable (suggest HTTP {suggest_code}, SSR HTTP {ssr_code}); not reporting a false zero")


def money(v: float | None) -> str:
    if v is None:
        return "—"
    return f"{v:,.0f}" if v.is_integer() else f"{v:,.2f}"


def main(argv: list[str]) -> int:
    if not argv:
        print('usage: hp.sh "<query>" [--no-cache]', file=sys.stderr)
        return 2
    failed = False
    for q in argv:
        try:
            rows, source = fetch(q)
        except RuntimeError as e:
            print(f"FAIL HomePro «{q}»: {e}", file=sys.stderr)
            failed = True
            continue
        print(f"### HomePro «{q}» — {len(rows)} (source: {source})")
        for r in rows[:20]:
            old = f" (было ฿{money(r['original_price'])})" if r["original_price"] and r["original_price"] != r["price"] else ""
            print(f"  ฿{money(r['price']):>9}  {r['name'][:70]}{old}")
            print(f"             {r['name_en'][:60]}  {r['url']}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
