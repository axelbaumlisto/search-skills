#!/usr/bin/env python3
"""Facebook Marketplace search WITHOUT driving the remote browser.

The server-side skill replays a Marketplace GraphQL query inside a logged-in
page. The only things that query really needs are session cookies, a fresh
`fb_dtsg` token and the cached `doc_id` — all of which can be obtained with
plain HTTP. This module does exactly that, so a search costs one HTTPS call
instead of an ssh round-trip plus a shared Chrome tab.

Falls back is the caller's job: on any failure raise/print and let the wrapper
use the browser path.

Inputs:
  cookies  $FB_COOKIES, default ~/.config/fb-marketplace/facebook.cookies.txt (netscape)
  template $FB_TEMPLATE, default ~/.config/fb-marketplace/fb_marketplace_graphql.json
"""
from __future__ import annotations

import argparse
import gzip
import http.cookiejar
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

# Куда положены сессия и состояние — дело установки, а не скилла: пути берутся
# из окружения, значения по умолчанию лежат под ~/.config/fb-marketplace.
import os

HOME_DIR = Path(os.environ.get("FB_HOME", Path.home() / ".config" / "fb-marketplace"))
COOKIES = Path(os.environ.get("FB_COOKIES", HOME_DIR / "facebook.cookies.txt"))
TEMPLATE = Path(os.environ.get("FB_TEMPLATE", HOME_DIR / "fb_marketplace_graphql.json"))
STATE = Path(os.environ.get("FB_STATE", HOME_DIR / "fb_local_state.json"))
# Каталог со скриптами браузерного пути; нужен только для запасного варианта.
BROWSER_SCRIPTS = Path(os.environ.get("FB_BROWSER_SCRIPTS", HOME_DIR / "browser-scripts"))

# Anti-ban budget. Facebook flags on request velocity, not on volume per se;
# community-reported blocks start around 10-20 req/min from one address, so we
# stay two orders of magnitude below that and cap the hourly total.
MIN_INTERVAL_S = 4.0        # hard floor between any two requests
JITTER_S = 3.0              # + random, so the cadence is never machine-perfect
MAX_PER_HOUR = 40
DTSG_TTL_S = 1200           # reuse the token instead of re-fetching a 2 MB page

# Markers that mean "stop immediately", not "retry".
CHECKPOINT_MARKERS = (
    "/checkpoint/", "1357004", "Your Account Has Been Restricted",
    "We limit how often", "1390008", "You Can't Use This Feature Right Now",
)


class FbBlocked(RuntimeError):
    """Facebook flagged the session. Never retry automatically."""


def _load_state() -> dict:
    try:
        return json.loads(STATE.read_text())
    except Exception:  # noqa: BLE001
        return {}


def _save_state(st: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st))


def _throttle() -> None:
    """Pace requests and refuse to exceed the hourly budget."""
    import random
    import time

    st = _load_state()
    now = time.time()
    hour = int(now // 3600)
    if st.get("hour") != hour:
        st["hour"], st["count"] = hour, 0
    if st.get("count", 0) >= MAX_PER_HOUR:
        raise FbBlocked(
            f"self-imposed budget reached ({MAX_PER_HOUR} requests this hour). "
            "Wait for the next hour rather than risking a checkpoint.")
    wait = (st.get("last", 0) + MIN_INTERVAL_S) - now
    wait = max(wait, 0) + random.uniform(0, JITTER_S)
    if wait:
        time.sleep(wait)
    st["last"] = time.time()
    st["count"] = st.get("count", 0) + 1
    _save_state(st)


def _guard_response(text: str, final_url: str = "") -> None:
    blob = f"{final_url}\n{text[:20000]}"
    for marker in CHECKPOINT_MARKERS:
        if marker in blob:
            raise FbBlocked(
                f"Facebook flagged this session (marker: {marker!r}). "
                "Do NOT retry: open Facebook in the real browser on remote-browser "
                "(https://YOUR-HOST/vnc), clear the checkpoint by hand, then "
                "leave the account idle for a while.")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36")

# Facebook answers 400 to "nearly-browser" requests: the full Chrome client-hint
# and Sec-Fetch set is mandatory, not decorative.
BROWSER_HEADERS = [
    ("User-Agent", UA),
    ("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,"
               "image/avif,image/webp,*/*;q=0.8"),
    ("Accept-Language", "en-US,en;q=0.9"),
    ("Accept-Encoding", "gzip, deflate"),
    ("sec-ch-ua", '"Chromium";v="148", "Google Chrome";v="148", "Not?A_Brand";v="24"'),
    ("sec-ch-ua-mobile", "?0"),
    ("sec-ch-ua-platform", '"macOS"'),
    ("Sec-Fetch-Dest", "document"),
    ("Sec-Fetch-Mode", "navigate"),
    ("Sec-Fetch-Site", "none"),
    ("Sec-Fetch-User", "?1"),
    ("Upgrade-Insecure-Requests", "1"),
]


def _read(response) -> str:
    raw = response.read()
    if response.headers.get("Content-Encoding") == "gzip":
        raw = gzip.decompress(raw)
    return raw.decode("utf-8", "replace")

# Запросный слой (шаблон GraphQL, города, разбор рёбер) живёт рядом со
# скриптами браузерного пути и ставится отдельно. Без него HTTP-путь не
# работает, но модуль обязан импортироваться: иначе падает всё, включая тесты
# чистых функций. Раньше путь был вшит в приватный каталог, и снаружи этот
# импорт валился с ModuleNotFoundError.
sys.path.insert(0, str(BROWSER_SCRIPTS))
try:
    from fb_marketplace import CITY_COORDS, merge_variables, parse_edges  # noqa: E402
except ModuleNotFoundError:  # pragma: no cover - зависит от установки
    CITY_COORDS = {}

    def _missing(*_a, **_k):
        raise SystemExit(
            "fb_marketplace.py не найден. Положи скрипты браузерного пути в "
            f"{BROWSER_SCRIPTS} или задай FB_BROWSER_SCRIPTS."
        )

    merge_variables = parse_edges = _missing


class FbLocalError(RuntimeError):
    """Anything that means: fall back to the browser path."""


def _opener() -> urllib.request.OpenerDirector:
    if not COOKIES.exists():
        raise FbLocalError(f"no cookie file at {COOKIES}")
    jar = http.cookiejar.MozillaCookieJar()
    try:
        jar.load(str(COOKIES), ignore_discard=True, ignore_expires=True)
    except Exception as exc:  # noqa: BLE001
        raise FbLocalError(f"cannot read cookies: {exc}") from exc
    names = {c.name for c in jar}
    if not {"c_user", "xs"} <= names:
        raise FbLocalError("cookies lack c_user/xs — session not logged in")
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    op.addheaders = list(BROWSER_HEADERS)
    return op


def fetch_tokens(op) -> tuple[str, str]:
    """fb_dtsg is per-session and short-lived; scrape it from any logged-in page."""
    import time

    st = _load_state()
    cached = st.get("dtsg")
    if cached and time.time() - cached.get("at", 0) < DTSG_TTL_S:
        return cached["dtsg"], cached.get("lsd", "")

    _throttle()
    try:
        with op.open("https://www.facebook.com/marketplace/", timeout=40) as r:
            html = _read(r)
            final_url = r.url
    except urllib.error.HTTPError as exc:
        raise FbLocalError(f"HTTP {exc.code} on marketplace page "
                           f"(headers rejected or session blocked)") from exc
    _guard_response(html, final_url)
    if "login" in final_url and "marketplace" not in final_url:
        raise FbLocalError("redirected to login — cookies expired")
    if '"USER_ID":"0"' in html:
        raise FbLocalError("page says logged out — refresh cookies from remote-browser Chrome")
    dtsg = None
    for pattern in (r'"DTSGInitialData",\[\],\{"token":"([^"]+)"',
                    r'name="fb_dtsg" value="([^"]+)"',
                    r'"dtsg":\{"token":"([^"]+)"'):
        m = re.search(pattern, html)
        if m:
            dtsg = m.group(1)
            break
    if not dtsg:
        raise FbLocalError("fb_dtsg not found in page (layout changed or logged out)")
    m = re.search(r'"LSD",\[\],\{"token":"([^"]+)"', html)
    lsd = m.group(1) if m else ""
    st = _load_state()
    st["dtsg"] = {"dtsg": dtsg, "lsd": lsd, "at": time.time()}
    _save_state(st)
    return dtsg, lsd


def graphql(op, dtsg: str, lsd: str, doc_id: str, friendly: str, variables: dict) -> dict:
    body = urllib.parse.urlencode({
        "fb_dtsg": dtsg,
        "lsd": lsd,
        "fb_api_caller_class": "RelayModern",
        "fb_api_req_friendly_name": friendly,
        "doc_id": doc_id,
        "variables": json.dumps(variables, ensure_ascii=False),
        "server_timestamps": "true",
    }).encode()
    req = urllib.request.Request(
        "https://www.facebook.com/api/graphql/", data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "X-FB-LSD": lsd, "User-Agent": UA})
    _throttle()
    try:
        with op.open(req, timeout=60) as r:
            if r.status != 200:
                raise FbLocalError(f"graphql HTTP {r.status}")
            text = _read(r)
    except urllib.error.HTTPError as exc:
        raise FbLocalError(f"graphql HTTP {exc.code}") from exc
    _guard_response(text)
    first = text.split("\n", 1)[0]
    try:
        data = json.loads(first)
    except json.JSONDecodeError as exc:
        raise FbLocalError(f"graphql body not JSON: {text[:120]}") from exc
    if data.get("errors"):
        raise FbLocalError(f"graphql errors[]: {str(data['errors'])[:200]}")
    return data


def search(query: str, city: str | None, limit: int, lat=None, lng=None,
           radius_km=25, min_price=None, max_price=None, days=None,
           local_only=True) -> dict:
    if not TEMPLATE.exists():
        raise FbLocalError(f"no GraphQL template at {TEMPLATE} (copy it from remote-browser)")
    cache = json.loads(TEMPLATE.read_text())
    if city:
        key = city.lower()
        if key not in CITY_COORDS:
            raise FbLocalError(f"unknown city {city}; known: {', '.join(sorted(CITY_COORDS))}")
        coords = CITY_COORDS[key]
        lat = coords["lat"] if isinstance(coords, dict) else coords[0]
        lng = coords["lng"] if isinstance(coords, dict) else coords[1]
    variables = merge_variables(
        cache["variables_template"], query=query, lat=lat, lng=lng,
        radius_km=radius_km, min_price=min_price, max_price=max_price,
        days=days, shipping=not local_only)
    op = _opener()
    dtsg, lsd = fetch_tokens(op)
    data = graphql(op, dtsg, lsd, cache["doc_id"], cache["friendly_name"], variables)
    listings = parse_edges(data)[:limit]
    return {"count": len(listings), "query": query, "backend": "graphql-local",
            "geo_verified": bool(city or lat), "listings": listings}


def main() -> int:
    p = argparse.ArgumentParser(description="Marketplace search over plain HTTP (no browser)")
    p.add_argument("query")
    p.add_argument("city", nargs="?")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--lat", type=float)
    p.add_argument("--lng", type=float)
    p.add_argument("--radius-km", type=float, default=25)
    p.add_argument("--min-price", type=int)
    p.add_argument("--max-price", type=int)
    p.add_argument("--days", type=int)
    p.add_argument("--shipping", action="store_true", help="include shipped items")
    a = p.parse_args()
    try:
        out = search(a.query, a.city, a.limit, a.lat, a.lng, a.radius_km,
                     a.min_price, a.max_price, a.days, local_only=not a.shipping)
    except FbBlocked as exc:
        print(json.dumps({"error": str(exc), "blocked": True, "fallback": "none — stop"},
                         ensure_ascii=False))
        return 4
    except FbLocalError as exc:
        print(json.dumps({"error": str(exc), "fallback": "use fb-search.sh (browser on remote-browser)"},
                         ensure_ascii=False))
        return 3
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
