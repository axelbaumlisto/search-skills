"""Facebook Marketplace через скрипт на хосте с залогиненным браузером (гео-поиск + карточки)."""
from __future__ import annotations

import json
import shlex
from dataclasses import replace

from ..models import Listing
from ..parse import parse_bedrooms, parse_price_vnd
from ..remote import remote_path, run_detached


PLAUSIBLE_MIN = 100_000   # «₫5,500» в поле цены = продавец имел в виду 5,5 млн; берём цену из текста


def _price(field: str | None, title: str) -> int | None:
    v = parse_price_vnd(field or "")
    return v if v is not None and v >= PLAUSIBLE_MIN else parse_price_vnd(title)


def parse_search(payload: dict) -> list[Listing]:
    out = []
    for it in payload.get("listings", []):
        title = " ".join((it.get("title") or "").split())
        out.append(Listing(source="facebook", url=it["url"], title=title, text=title,
                           price_vnd=_price(it.get("price"), title), bedrooms=parse_bedrooms(title),
                           geo_bound=True))
    return out


def apply_detail(x: Listing, d: dict) -> Listing:
    text = f"{d.get('title') or x.title}\n{d.get('description') or ''}"
    return replace(x, text=text, price_vnd=x.price_vnd or _price(d.get("price"), text),
                   bedrooms=x.bedrooms or parse_bedrooms(text), contact=d.get("seller") or x.contact,
                   area=d.get("location") or x.area)


def _run(cfg, args: str) -> dict:
    f = cfg.facebook
    out = run_detached(f["remote_host"], f"cd ~ && python3 {remote_path(f['remote_script'])} {args}")
    return json.loads(out[out.find("{"):]) if "{" in out else {}


def fetch(cfg, since=None) -> list[Listing]:
    f = cfg.facebook
    seen: dict[str, Listing] = {}
    for q in f["queries"]:
        data = _run(cfg, f"search --query {shlex.quote(q)} --limit {f.get('limit', 30)} --lat {f['lat']} "
                         f"--lng {f['lng']} --radius-km {f.get('radius_km', 25)} --local-only")
        if data.get("blocked") or "checkpoint" in str(data.get("error", "")):
            raise RuntimeError(f"Facebook blocked: {data.get('error')}")
        for x in parse_search(data):
            seen.setdefault(x.url, x)
    return list(seen.values())


def enrich(cfg, items: list[Listing]) -> list[Listing]:
    """Дочитать карточку для кандидатов без спален/цены — дорого (~45 с), поэтому с лимитом."""
    limit = cfg.facebook.get("max_details", 5)
    out, done = [], 0
    for x in items:
        if done < limit and (x.bedrooms is None or x.price_vnd is None):
            item_id = x.url.rstrip("/").rsplit("/", 1)[-1]
            x = apply_detail(x, _run(cfg, f"detail --item-id {item_id}"))
            done += 1
        out.append(x)
    return out
