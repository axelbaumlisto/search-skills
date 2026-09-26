"""Расстояния и приблизительные координаты районов Фукуока по тексту."""
from __future__ import annotations

from math import asin, cos, radians, sin, sqrt

# ключ — подстрока в нижнем регистре; координаты — центр района (приблизительно)
AREAS: dict[str, tuple[float, float]] = {
    "ночного рынка": (10.2166, 103.9587), "chợ đêm": (10.2166, 103.9587), "dinh cậu": (10.2177, 103.9565),
    "30/4": (10.2170, 103.9630), "dương đông": (10.2156, 103.9609), "duong dong": (10.2156, 103.9609),
    "дуонг донг": (10.2156, 103.9609), "cây thông": (10.2310, 104.0010), "suối đá": (10.2400, 103.9780),
    "ông lang": (10.2670, 103.9470), "ong lang": (10.2670, 103.9470), "онг ланг": (10.2670, 103.9470),
    "cửa lấp": (10.1650, 103.9800), "dương tơ": (10.1560, 103.9890), "suối mây": (10.1760, 103.9960),
    "búng gội": (10.2800, 103.9560), "đường bào": (10.2060, 104.0100), "cửa cạn": (10.3150, 103.9420),
    "meyhomes": (10.1110, 103.9790), "мейхоумс": (10.1110, 103.9790), "grand world": (10.3350, 103.8560),
    "an thới": (10.0200, 104.0120), "an thoi": (10.0200, 104.0120), "антхой": (10.0200, 104.0120),
    "hàm ninh": (10.1830, 104.0500), "gành dầu": (10.3700, 103.8590), "sân bay": (10.1700, 103.9930),
}


def distance_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    dlat, dlng = radians(lat2 - lat1), radians(lng2 - lng1)
    a = sin(dlat / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlng / 2) ** 2
    return 2 * 6371 * asin(sqrt(a))


def guess_coords(text: str) -> tuple[float, float] | None:
    t = text.lower()
    hits = [(t.find(k), v) for k, v in AREAS.items() if k in t]
    return min(hits)[1] if hits else None
