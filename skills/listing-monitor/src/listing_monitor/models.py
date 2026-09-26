"""Единая модель объявления — все источники приводят свои ответы к ней."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass
class Listing:
    source: str                     # chotot | facebook | telegram | muaban
    url: str                        # ключ уникальности
    title: str
    text: str = ""
    price_vnd: int | None = None
    price_note: str = ""            # цена угадана (напр. «₫7,500» → 7,5 млн) — показать исходник
    bedrooms: int | None = None
    kind: str = "unknown"           # rent | sale | unknown
    lat: float | None = None
    lng: float | None = None
    area: str = ""                  # район/улица для человека
    posted: datetime | None = None
    contact: str = ""
    group_url: str = ""             # чат/группа, куда надо вступить, чтобы открыть пост
    group_name: str = ""
    geo_bound: bool = False         # источник уже ограничен городом (API-район, гео-поиск)

    @property
    def blob(self) -> str:
        return f"{self.title}\n{self.area}\n{self.text}"
