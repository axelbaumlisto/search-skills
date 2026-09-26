"""Подходит ли объявление под критерии поиска. Отправляем только то, где цена и спальни известны."""
from __future__ import annotations

from .config import Config
from .models import Listing
from .parse import is_daily_rental


def matches(x: Listing, cfg: Config) -> tuple[bool, str]:
    if x.kind in ("sale", "expired"):
        return False, "продажа или снято"
    blob = x.blob.lower()
    if is_daily_rental(blob):
        return False, "посуточно"
    if any(k in blob for k in cfg.exclude_keywords):
        return False, "другой город"
    if x.price_vnd is None:
        return False, "нет цены"
    if not cfg.min_price_vnd <= x.price_vnd <= cfg.max_price_vnd:
        return False, "цена вне диапазона"
    if x.bedrooms is None:
        return False, "не указаны спальни"
    if x.bedrooms < cfg.min_bedrooms:
        return False, "мало спален"
    if not x.geo_bound and not any(k in blob for k in cfg.city_keywords):
        return False, "не тот город"
    return True, "ok"
