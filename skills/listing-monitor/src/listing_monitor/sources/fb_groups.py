"""Посты групп Facebook как источник объявлений.

Отличие от источника `facebook`: тот ходит в Marketplace, здесь — поиск внутри
конкретных групп. В группах живёт то, чего в Marketplace нет: аренда от
хозяев, распродажи оборудования при закрытии заведений, объявления сообществ.

Сбор выполняет `scripts/fb_group_search.py` через локальный залогиненный Chrome
(мост из скилла browser-scout), потому что удалённый `fb_marketplace.py` на
хосте отсутствует, а групповой поиск всё равно требует живой сессии.
"""
from __future__ import annotations

import json
import shlex
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ..models import Listing
from ..parse import is_offer, parse_bedrooms, parse_price_vnd

SCRIPT = Path(__file__).resolve().parents[3] / 'scripts' / 'fb_group_search.py'

# «3 giờ», «Hôm qua», «2 ngày» — грубая оценка свежести из выдачи Facebook
_UNITS = {'phút': 'minutes', 'giờ': 'hours', 'ngày': 'days', 'tuần': 'weeks'}


def parse_time(s: str, now: datetime | None = None) -> datetime | None:
    now = now or datetime.now(timezone.utc)
    s = (s or '').strip().lower()
    if not s:
        return None
    if 'hôm qua' in s:
        return now - timedelta(days=1)
    parts = s.split()
    if len(parts) >= 2 and parts[0].isdigit():
        for vi, unit in _UNITS.items():
            if vi in s:
                return now - timedelta(**{unit: int(parts[0])})
    return None


def parse(payload: dict, offer: str = 'rent', now: datetime | None = None) -> list[Listing]:
    """Посты → Listing. Не-предложения (спрос, «cần thuê») отсеиваются."""
    out = []
    for p in payload.get('posts', []):
        text = p.get('text') or ''
        if not is_offer(text, offer):
            continue
        out.append(Listing(
            source='fb_groups',
            url=p.get('url') or p.get('group_url', ''),
            title=text.split('.')[0][:80],
            text=text,
            price_vnd=parse_price_vnd(text),
            bedrooms=parse_bedrooms(text),
            kind=offer,
            posted=parse_time(p.get('time', ''), now),
            group_url=p.get('group_url', ''),
            group_name=p.get('group', ''),
            contact=p.get('author', ''),
            geo_bound=True,          # группы города = город известен
        ))
    return out


def fetch(cfg, since=None) -> list[Listing]:
    g = cfg.fb_groups
    cmd = (f'{sys.executable} {shlex.quote(str(SCRIPT))} '
           f'--groups {shlex.quote(",".join(g["groups"]))} '
           f'--queries {shlex.quote(",".join(g["queries"]))} '
           f'--limit {g.get("limit", 10)}')
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                         timeout=g.get('timeout_sec', 900))
    if res.returncode != 0:
        raise RuntimeError(f'fb_group_search упал: {res.stderr.strip()[:200]}')
    data = json.loads(res.stdout[res.stdout.find('{'):]) if '{' in res.stdout else {}
    if data.get('errors'):
        first = data['errors'][0]
        if 'Страниц' in first.get('error', '') or 'ineligible' in first.get('error', ''):
            raise RuntimeError(first['error'])
    items = parse(data, cfg.offer)
    seen: dict[str, Listing] = {}
    for x in items:
        seen.setdefault(x.url + x.title[:40], x)
    return list(seen.values())
