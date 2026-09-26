"""Разбор свободного текста объявлений: цена, спальни, «сдаю/ищу». Чистые функции."""
from __future__ import annotations

import re

USD_VND = 25_500

_NUM = r"(\d+(?:[.,]\d+)?)"
_WORD_NUM = {"одна": 1, "одну": 1, "две": 2, "два": 2, "три": 3, "четыре": 4, "пять": 5}


def _f(s: str) -> float:
    return float(s.replace(",", "."))


def parse_price_vnd(text: str) -> int | None:
    t = text.lower()
    m = re.search(r"₫\s*([\d][\d,.]{3,})", t) or re.search(r"([\d][\d,.]{6,})\s*(?:₫|vnd|đ\b)", t)
    if m:
        return int(re.sub(r"[^\d]", "", m.group(1)))
    if m := re.search(_NUM + r"\s*tỷ", t):
        return int(_f(m.group(1)) * 1_000_000_000)
    if m := re.search(_NUM + r"\s*(?:tr\b|tr(?=[\s/.,)]|$)|triệu|млн|миллион\w*|mil\b|m\b|м(?![²2а-яё]))", t):
        return int(_f(m.group(1)) * 1_000_000)
    if m := re.search(r"\$\s*" + _NUM + r"|" + _NUM + r"\s*(?:\$|usd)", t):
        return int(_f(m.group(1) or m.group(2)) * USD_VND)
    return None


def parse_bedrooms(text: str) -> int | None:
    t = text.lower()
    pat = r"(?:\s*-?х?\s*)(?:pn\b|phòng ngủ|спальн\w*|br\b|bedrooms?|bed\b)"
    if m := re.search(r"(\d+)" + pat, t):
        return int(m.group(1))
    if m := re.search(r"\b(" + "|".join(_WORD_NUM) + r")\s+спальн", t):
        return _WORD_NUM[m.group(1)]
    return None


_SEEKING = re.compile(r"кто сда[её]т|ищ(у|ем|ет)|сниму|сними|снять|cần thuê|tìm thuê|tìm nhà|looking for|\?\s*$", re.M)
_OFFER = re.compile(r"сда[её]тся|сда[мю]\b|сдаю|арендная плата|аренда (дом|вилл|квартир)|cho thuê|for rent|#фукуок")
_NOT_HOUSING = re.compile(r"байк|скутер|мотоцикл|xe máy|bike|авто в аренду")


def is_rent_offer(text: str) -> bool:
    t = text.lower()
    if _NOT_HOUSING.search(t) or _SEEKING.search(t[:200]):
        return False
    return bool(_OFFER.search(t))


_DAILY = re.compile(r"homestay|/\s*(đêm|ngày|night|сутки|ночь)|theo ngày|per night|посуточно|за ночь")


def is_daily_rental(text: str) -> bool:
    return bool(_DAILY.search(text.lower()))
