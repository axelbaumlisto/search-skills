"""Подходит ли объявление под критерии поиска. Цена обязательна, спальни — только если заданы в конфиге."""
from __future__ import annotations

from .config import Config
from .models import Listing
from .parse import is_daily_rental


def is_placeholder_price(v: int) -> bool:
    """1 234 567, 9 999 999, 1 111 111 — продавец не указал цену, поле обязательное."""
    d = str(v).rstrip("0") or "0"
    return len(set(d)) == 1 and len(d) >= 4 or d in "1234567890" and len(d) >= 6


def matches(x: Listing, cfg: Config) -> tuple[bool, str]:
    if x.kind == "expired" or x.kind in ("rent", "sale") and x.kind != cfg.offer:
        return False, "снято или не тот тип (аренда/продажа)"
    blob = x.blob.lower()
    if cfg.offer == "rent" and is_daily_rental(blob):
        return False, "посуточно"
    if any(k in blob for k in cfg.exclude_keywords):
        return False, "исключено"
    if cfg.include_any and not any(k in blob for k in cfg.include_any):
        return False, "не та категория"
    if x.price_vnd is None or is_placeholder_price(x.price_vnd):
        return False, "нет цены"
    if not cfg.min_price_vnd <= x.price_vnd <= cfg.max_price_vnd:
        return False, "цена вне диапазона"
    if cfg.min_bedrooms:
        if x.bedrooms is None:
            return False, "не указаны спальни"
        if x.bedrooms < cfg.min_bedrooms:
            return False, "мало спален"
    if not x.geo_bound and not any(k in blob for k in cfg.city_keywords):
        return False, "не тот город"
    return True, "ok"
