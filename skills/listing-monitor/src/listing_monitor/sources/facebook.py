"""Facebook Marketplace через скрипт на хосте с залогиненным браузером (гео-поиск + карточки)."""
from __future__ import annotations

import json
import shlex
from dataclasses import replace

from ..models import Listing
from ..parse import parse_bedrooms, parse_price_vnd
from ..remote import remote_path, run_detached


PLAUSIBLE_MIN = 100_000   # ниже — продавец написал цену в тысячах: «₫5,500» = 5,5 млн


def _guessed(field: str | None, title: str) -> bool:
    v = parse_price_vnd(field or "")
    return v is not None and 1_000 <= v < PLAUSIBLE_MIN and parse_price_vnd(title) is None


def _price(field: str | None, title: str) -> int | None:
    v = parse_price_vnd(field or "")
    if v is not None and v >= PLAUSIBLE_MIN:
        return v
    if (t := parse_price_vnd(title)) is not None:
        return t
    return v * 1000 if v and v >= 1_000 else None


def parse_search(payload: dict) -> list[Listing]:
    out = []
    for it in payload.get("listings", []):
        title = " ".join((it.get("title") or "").split())
        out.append(Listing(source="facebook", url=it["url"], title=title, text=title,
                           price_vnd=_price(it.get("price"), title), bedrooms=parse_bedrooms(title),
                           price_note=it.get("price") or "" if _guessed(it.get("price"), title) else "",
                           geo_bound=True))
    return out


def city_confirmed(cfg, *parts: str) -> bool:
    """Город подтверждён текстом карточки, а не гео-фильтром Facebook.

    «Listed in Phú Quốc» в выдаче — это место ПРОДАВЦА. 26.09.2026 так уехал
    дом в Далате: в заголовке города нет, в описании «Đà Lạt, Phường 4».
    """
    blob = " ".join(p or "" for p in parts).lower()
    if any(k in blob for k in cfg.exclude_keywords):
        return False
    return any(k in blob for k in cfg.city_keywords)


def apply_detail(x: Listing, d: dict, cfg=None) -> Listing:
    text = f"{d.get('title') or x.title}\n{d.get('description') or ''}"
    exact = parse_price_vnd(d.get("description") or "")
    price, note = (exact, "") if exact and (x.price_vnd is None or x.price_note) else (x.price_vnd or _price(d.get("price"), text), x.price_note)
    geo = x.geo_bound if cfg is None else city_confirmed(cfg, text, d.get("location"))
    return replace(x, text=text, price_vnd=price, price_note=note, geo_bound=geo,
                   bedrooms=x.bedrooms or parse_bedrooms(text), contact=d.get("seller") or x.contact,
                   area=d.get("location") or x.area)


def _run(cfg, args: str) -> dict:
    f = cfg.facebook
    out = run_detached(f["remote_host"], f"cd ~ && python3 {remote_path(f['remote_script'])} {args}")
    return json.loads(out[out.find("{"):]) if "{" in out else {}


def search_args(cfg, query: str) -> str:
    """Гео: пресет города скрипта (`city = "danang"`) или координаты с радиусом."""
    f = cfg.facebook
    geo = f"--city {f['city']}" if f.get("city") else \
        f"--lat {f['lat']} --lng {f['lng']} --radius-km {f.get('radius_km', 25)}"
    return f"search --query {shlex.quote(query)} --limit {f.get('limit', 30)} {geo} --local-only"


def fetch(cfg, since=None) -> list[Listing]:
    seen: dict[str, Listing] = {}
    for q in cfg.facebook["queries"]:
        data = _run(cfg, search_args(cfg, q))
        if data.get("blocked") or "checkpoint" in str(data.get("error", "")):
            raise RuntimeError(f"Facebook blocked: {data.get('error')}")
        for x in parse_search(data):
            seen.setdefault(x.url, x)
    return list(seen.values())


def enrich(cfg, items: list[Listing]) -> list[Listing]:
    """Дочитать карточку, если не хватает того, что проверяет фильтр (цена; спальни — если заданы).
    Дорого (~45 с на карточку), поэтому с лимитом."""
    limit = cfg.facebook.get("max_details", 5)
    out, done = [], 0
    for x in items:
        # Гео Facebook — это место ПРОДАВЦА, не объекта. С verify_city = true
        # карточка дочитывается ради города и неподтверждённые не уходят за свой.
        # По умолчанию выключено: чтение карточки стоит ~45 с.
        unverified = cfg.facebook.get("verify_city") and not city_confirmed(cfg, x.title, x.text)
        need = x.price_vnd is None or x.price_note or (cfg.min_bedrooms and x.bedrooms is None) or unverified
        if done < limit and need:
            item_id = x.url.rstrip("/").rsplit("/", 1)[-1]
            try:
                x = apply_detail(x, _run(cfg, f"detail --item-id {item_id}"), cfg)
            except Exception:        # таймаут ssh или занятый браузер — не повод терять объявление
                x = replace(x, geo_bound=False) if unverified else x
            done += 1
        elif unverified:
            x = replace(x, geo_bound=False)      # не подтвердили — не выдаём за свой город
        out.append(x)
    return out
