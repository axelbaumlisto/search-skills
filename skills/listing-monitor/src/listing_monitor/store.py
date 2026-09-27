"""Состояние между запусками: что уже видели и что отправили."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from .models import Listing


# Короткий текст — плохой отпечаток: «Cho thuê nhà 2 phòng ngủ» пишут сотни
# разных объявлений. Схлопываем только те, где совпадает развёрнутое описание.
_MIN_WORDS = 10


def _fingerprint(x: Listing) -> str | None:
    """Отпечаток объявления: начало текста без разметки и пунктуации.

    Одно и то же объявление перепечатывают в несколько групп — с эмодзи,
    своими переносами строк и телефоном в конце. Начало описания совпадает,
    поэтому сравниваем его, а не ссылку. Для коротких текстов возвращаем None:
    там совпадение ничего не доказывает.
    """
    words = re.sub(r"[^\w\s]", " ", (x.text or "").lower()).split()
    if len(words) < _MIN_WORDS:
        return None
    return f"{x.price_vnd or 0}|" + " ".join(words[:14])


@dataclass
class State:
    path: Path
    last_run: datetime | None = None
    seen: set[str] = field(default_factory=set)
    sent: set[str] = field(default_factory=set)

    @classmethod
    def load(cls, path: Path) -> "State":
        if not Path(path).exists():
            return cls(Path(path))
        d = json.loads(Path(path).read_text())
        lr = d.get("last_run")
        return cls(Path(path), datetime.fromisoformat(lr) if lr else None, set(d.get("seen", [])), set(d.get("sent", [])))

    def new(self, items: list[Listing]) -> list[Listing]:
        # Дедуп по URL не спасает: один дом висит в трёх группах и на Marketplace,
        # ссылки разные — человек получает его трижды. Второй ключ — сам текст.
        out, keys, texts = [], set(), set()
        for x in items:
            body = _fingerprint(x)
            if x.url in self.seen or x.url in self.sent or x.url in keys:
                continue
            if body is not None and body in texts:
                continue
            out.append(x)
            keys.add(x.url)
            if body is not None:
                texts.add(body)
        return out

    def mark_seen(self, items: list[Listing]) -> None:
        self.seen |= {x.url for x in items}

    def mark_sent(self, items: list[Listing]) -> None:
        self.sent |= {x.url for x in items}

    def save(self, now: datetime | None = None) -> None:
        self.last_run = now or datetime.now(timezone.utc)
        self.path.write_text(json.dumps({"last_run": self.last_run.isoformat(), "seen": sorted(self.seen),
                                         "sent": sorted(self.sent)}, ensure_ascii=False, indent=1))
