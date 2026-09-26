"""Один проход: собрать → отсеять виденное → проверить критерии → записать → отправить."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable
from zoneinfo import ZoneInfo

from .config import Config
from .filters import matches
from .models import Listing
from .report import render_markdown, render_message
from .store import State

Source = Callable[[Config, datetime | None], list[Listing]]
TZ = ZoneInfo("Asia/Ho_Chi_Minh")


@dataclass
class Result:
    matched: list[Listing] = field(default_factory=list)
    stats: str = ""


def default_sources(cfg: Config) -> dict[str, Source]:
    from .sources import enabled
    return {name: mod.fetch for name, mod in enabled(cfg).items()}


def default_enrich(cfg: Config, items: list[Listing]) -> list[Listing]:
    """Каждый источник сам дочитывает свои объявления, если умеет (enrich)."""
    from .sources import enabled
    out = []
    for name, mod in enabled(cfg).items():
        mine = [x for x in items if x.source == name]
        out += mod.enrich(cfg, mine) if mine and hasattr(mod, "enrich") else mine
    return out + [x for x in items if x.source not in enabled(cfg)]


def refresh(cfg: Config, sources: dict[str, Source] | None = None, send: Callable[[str], object] | None = None,
            now: datetime | None = None, dry_run: bool = False, enrich: Callable | None = None,
            since_days: int | None = None) -> Result:
    now = now or datetime.now(timezone.utc)
    state = State.load(cfg.state_path)
    if since_days:
        since = now - timedelta(days=since_days)          # первый прогон нового поиска: весь текущий рынок
    else:
        since = (state.last_run - timedelta(hours=12)) if state.last_run else now - timedelta(days=2)
    sources = default_sources(cfg) if sources is None else sources

    collected, stats = [], []
    for name, fetch in sources.items():
        try:
            got = fetch(cfg, since)
            stats.append(f"{name}: {len(got)}")
            collected += got
        except Exception as e:                       # один упавший источник не валит остальные
            stats.append(f"{name}: ошибка ({type(e).__name__}: {str(e)[:80]})")

    fresh = state.new(collected)
    if enrich:
        fresh = enrich(cfg, fresh)
    matched = [x for x in fresh if matches(x, cfg)[0]]
    stat_line = f"Проверено: {', '.join(stats)}; новых {len(fresh)}, подходящих {len(matched)}."
    res = Result(matched=matched, stats=stat_line)
    if dry_run:
        return res

    local = now.astimezone(TZ)
    with open(cfg.master_path, "a", encoding="utf-8") as f:
        f.write(render_markdown(matched, cfg, local.strftime("%Y-%m-%d %H:%M"), stat_line))
    to_send = [x for x in matched if x.url not in state.sent]
    if send and to_send:
        send(render_message(to_send, cfg, local.strftime("%d.%m %H:%M")))
        state.mark_sent(to_send)
    state.mark_seen(fresh)
    state.save(now)
    return res
