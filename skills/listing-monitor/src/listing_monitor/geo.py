"""Расстояния и приблизительные координаты районов по тексту (таблица районов — из конфига)."""
from __future__ import annotations

from math import asin, cos, radians, sin, sqrt

def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dlat, dlng = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * 6371 * asin(sqrt(a))


def guess_coords(text: str, districts: dict) -> tuple[float, float] | None:
    t = text.lower()
    hits = [(t.find(k.lower()), tuple(v)) for k, v in districts.items() if k.lower() in t]
    return min(hits)[1] if hits else None
