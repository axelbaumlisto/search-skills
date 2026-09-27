"""Посты групп Facebook как источник объявлений.

Отличие от источника `facebook`: тот ходит в Marketplace, здесь — поиск внутри
конкретных групп. В группах живёт то, чего в Marketplace нет: аренда от
хозяев, распродажи оборудования при закрытии заведений, объявления сообществ.

Сбор идёт одним из двух путей, селекторы у них общие (`listing_monitor.fb_dom`):

* задан `remote_host` — скрипт выполняется на сервере с постоянно залогиненным
  Chrome (playwright по CDP). Проход не зависит от того, открыт ли браузер на
  ноутбуке и не спит ли он; так работает и источник `facebook`;
* иначе — локальный Chrome через мост из скилла browser-scout.

В обоих случаях нужен **личный профиль**: Страница в группы не ходит, Facebook
отвечает `Pages can't use Marketplace`.
"""
from __future__ import annotations

import json
import shlex
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .. import fb_dom
from ..models import Listing
from ..parse import is_offer, parse_bedrooms, parse_price_vnd
from ..remote import put_file, remote_path, run_detached

SCRIPTS = Path(__file__).resolve().parents[3] / 'scripts'
SCRIPT = SCRIPTS / 'fb_group_search.py'
REMOTE_SCRIPT = SCRIPTS / 'fb_group_search_remote.py'
REMOTE_DIR = '/tmp/listing-monitor'

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


def _run_local(g: dict) -> str:
    cmd = (f'{sys.executable} {shlex.quote(str(SCRIPT))} '
           f'--groups {shlex.quote(",".join(g["groups"]))} '
           f'--queries {shlex.quote(",".join(g["queries"]))} '
           f'--limit {g.get("limit", 10)}')
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True,
                         timeout=g.get('timeout_sec', 900))
    if res.returncode != 0:
        raise RuntimeError(f'fb_group_search упал: {res.stderr.strip()[:200]}')
    return res.stdout


def _run_remote(g: dict) -> str:
    """Доставляем скрипт и селекторы на хост и запускаем там.

    Скрипт кладётся каждый раз: так на сервере не остаётся версии, отставшей
    от репозитория, — расхождение вёрстки Facebook и селекторов ищется потом
    сутками.
    """
    host = g['remote_host']
    dom = {'expand': fb_dom.EXPAND, 'grab': fb_dom.GRAB, 'search_url': fb_dom.SEARCH_URL,
           'page_profile_error': fb_dom.PAGE_PROFILE_ERROR}
    put_file(host, REMOTE_SCRIPT.read_text(encoding='utf-8'), f'{REMOTE_DIR}/fb_group_search_remote.py',
             mkdir=REMOTE_DIR)
    put_file(host, json.dumps(dom, ensure_ascii=False), f'{REMOTE_DIR}/lm_fb_dom.json')
    limit_sec = g.get('timeout_sec', 900)
    cmd = (f'python3 {remote_path(REMOTE_DIR + "/fb_group_search_remote.py")} '
           f'--groups {shlex.quote(",".join(g["groups"]))} '
           f'--queries {shlex.quote(",".join(g["queries"]))} '
           f'--limit {g.get("limit", 10)} '
           # скрипт обязан свернуться раньше, чем ssh-обёртка его убьёт,
           # иначе собранное пропадёт вместе с процессом
           f'--budget-sec {max(60, limit_sec - 120)}')
    return run_detached(host, cmd, timeout=limit_sec)


def fetch(cfg, since=None) -> list[Listing]:
    g = cfg.fb_groups
    out = _run_remote(g) if g.get('remote_host') else _run_local(g)
    data = json.loads(out[out.find('{'):]) if '{' in out else {}
    errors = data.get('errors') or []
    if errors and not data.get('posts'):
        raise RuntimeError(errors[0].get('error', 'неизвестная ошибка'))
    if errors:
        # Часть пар «группа × запрос» отвалилась, остальные принесли объявления.
        # Молчать нельзя: со стороны это неотличимо от «в группах пусто».
        fetch.last_errors = errors
        print(f'fb_groups: {len(errors)} из {len(g["groups"]) * len(g["queries"])} '
              f'пар не ответили ({errors[0].get("error", "")[:60]})', file=sys.stderr)
    items = parse(data, cfg.offer)
    seen: dict[str, Listing] = {}
    for x in items:
        seen.setdefault(x.url + x.title[:40], x)
    return list(seen.values())
