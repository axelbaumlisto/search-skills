"""Представление найденного: раздел в markdown-файле и короткое сообщение в Telegram."""
from __future__ import annotations

import re

from .config import Config
from .geo import distance_km, guess_coords
from .models import Listing


def _mln(v: int | None) -> str:
    if v is None:
        return "?"
    s = f"{v / 1_000_000:.1f}".rstrip("0").rstrip(".")
    return s.replace(".", ",")


def _km(x: Listing, cfg: Config) -> str:
    c = (x.lat, x.lng) if x.lat and x.lng else guess_coords(x.blob, cfg.districts)
    if not c or not cfg.center:
        return "?"
    return f"~{distance_km(cfg.center['lat'], cfg.center['lng'], *c):.0f}"


def _beds(n: int | None) -> str:
    return "?" if n is None else f"{n} спальн{'я' if n == 1 else 'и' if n < 5 else 'ей'}"


def render_markdown(items: list[Listing], cfg: Config, stamp: str, stats: str = "") -> str:
    head = f"\n## Свежие — {stamp}\n\n"
    if not items:
        return head + f"новых подходящих нет. {stats}\n"
    cell = lambda v: str(v).replace("|", "/")
    rows = [f"| {_mln(x.price_vnd)} | {x.bedrooms} | {cell(x.title[:60])} | {cell(x.area[:40])} | {_km(x, cfg)} | "
            f"{cell(x.contact)} | {x.url} | {x.source} |" for x in items]
    return head + "| Цена, млн | PN | Заголовок | Район | До центра, км | Контакт | Ссылка | Источник |\n" \
        "|---|---|---|---|---|---|---|---|\n" + "\n".join(rows) + (f"\n\n{stats}\n" if stats else "\n")


_SYMBOLS = re.compile(r"[^\w\s.,:;!?()%/+–—-]", re.UNICODE)


def _short_title(title: str) -> str:
    """Без эмодзи и без английского дубля после «|»."""
    t = _SYMBOLS.sub("", title.split("|")[0])
    return " ".join(t.split())[:70]


def _where(x: Listing, cfg: Config) -> str:
    """Район — только если это не просто «город, провинция»."""
    parts = [p.strip() for p in x.area.split(",") if p.strip()]
    if not parts or (len(parts) <= 2 and parts[0].lower() in cfg.city_keywords):
        return ""
    return x.area


def _links(x: Listing) -> list[str]:
    if x.group_url:
        name = f"«{x.group_name}» " if x.group_name else ""
        return [f"   Группа {name}(вступить, чтобы открыть пост): {x.group_url}", f"   Пост: {x.url}"]
    if "facebook.com/marketplace" in x.url:
        return [f"   Facebook Marketplace (нужен вход в Facebook): {x.url}"]
    return [f"   {x.url}"]


def render_message(items: list[Listing], cfg: Config, stamp: str) -> str:
    if not items:
        return ""
    lines = [f"{cfg.name} — новые объявления ({stamp})"]
    for i, x in enumerate(items[:10], 1):
        per = "/мес" if cfg.offer == "rent" else ""
        price = f"~{_mln(x.price_vnd)} млн{per} (в объявлении «{x.price_note}»)" if x.price_note \
            else f"{_mln(x.price_vnd)} млн{per}"
        head = [price, _beds(x.bedrooms) if cfg.min_bedrooms else "", _short_title(x.title), _where(x, cfg)]
        km = _km(x, cfg)
        if km != "?":
            head.append(f"{km} км до {cfg.center['label']}")
        lines += ["", f"{i}) " + " · ".join(h for h in head if h and h != "?")] + _links(x)
    return "\n".join(lines)
