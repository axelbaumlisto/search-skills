"""Конфиг поиска из TOML — единственное место, где заданы город, бюджет, источники и получатель."""
from __future__ import annotations

import tomllib
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Config:
    name: str
    max_price_vnd: int
    city_keywords: list[str]                # город в тексте — для источников без гео-привязки
    offer: str = "rent"                     # rent | sale
    min_bedrooms: int = 0                   # 0 = спальни не нужны (не жильё)
    include_any: list[str] = field(default_factory=list)       # хотя бы одно слово категории (road, đua…)
    districts: dict = field(default_factory=dict)              # "район" = [lat, lng] для расстояний
    exclude_keywords: list[str] = field(default_factory=list)   # другие города — гео-поиск FB их подмешивает
    center: dict = field(default_factory=dict)
    chotot: dict = field(default_factory=dict)
    facebook: dict = field(default_factory=dict)
    fb_groups: dict = field(default_factory=dict)   # посты групп: {groups, queries, limit}
    telegram: dict = field(default_factory=dict)
    muaban: dict = field(default_factory=dict)
    notify: dict = field(default_factory=dict)
    state_path: Path = Path("state.json")
    master_path: Path = Path("master.md")
    min_price_vnd: int = 1_000_000          # ниже — это цена за ночь или мусор
    env_file: str = ""                      # файл с ключами (TG_API_ID/HASH), читается при загрузке конфига


def load_config(path: str | Path) -> Config:
    path = Path(path).expanduser()
    d = tomllib.loads(path.read_text())
    base = path.parent
    paths = d.pop("paths", {})
    resolve = lambda p: (base / Path(p).expanduser()) if not Path(p).expanduser().is_absolute() else Path(p).expanduser()
    if d.get("env_file"):
        from .tg import load_env_file
        load_env_file(d["env_file"])
    return Config(**d, state_path=resolve(paths.get("state", "state.json")),
                  master_path=resolve(paths.get("master", "master.md")))
