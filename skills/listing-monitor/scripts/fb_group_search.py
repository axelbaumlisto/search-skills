#!/usr/bin/env python3
"""Поиск постов внутри групп Facebook через локальный залогиненный Chrome.

Зачем отдельно от источника `facebook`: тот ходит в Marketplace на удалённом
хосте, а здесь нужны именно **посты групп** — в них живёт то, чего в
Marketplace нет: аренда от хозяев, распродажи оборудования, объявления
сообществ. Мост в Chrome общий, из скилла browser-scout.

    python3 fb_group_search.py --groups 1456487654963956,thanhlydocudn \\
                               --queries "máy pha cà phê,tủ mát" --limit 8

Вывод — JSON: {"posts": [{group, group_url, url, author, text, time}], "errors": []}

Ограничения, которые важно знать до использования:
  - аккаунт в Chrome должен быть **личным профилем**: Страница в группы не ходит
    (Facebook отвечает `Pages can't use Marketplace` и режет групповые действия);
  - у поста в выдаче поиска не всегда есть постоянная ссылка — тогда отдаётся
    ссылка на группу, а сам текст поста уже прочитан и попадает в результат;
  - это медленно: ~10 секунд на пару «группа × запрос», больше десятка пар за
    один проход не стоит.
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
from pathlib import Path

# Мост в Chrome живёт в соседнем скилле remote-browser. Ищем его рядом в репозитории,
# затем в установленных скиллах агента, затем в CHROMEBRIDGE_PATH.
for _p in (Path(__file__).resolve().parents[2] / 'remote-browser' / 'scripts',
           Path.home() / '.pi/agent/skills/browser-scout/scripts',
           Path(os.environ.get('CHROMEBRIDGE_PATH', ''))):
    if (_p / 'chromebridge.py').exists():
        sys.path.insert(0, str(_p))
        break
from chromebridge import Chrome, BridgeError          # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from listing_monitor.fb_dom import EXPAND, PAGE_PROFILE_ERROR, SEARCH_URL, grab   # noqa: E402

def search(ch: Chrome, group: str, query: str, limit: int) -> list[dict]:
    url = SEARCH_URL.format(group=group, query=urllib.parse.quote(query))
    ch.goto(url, settle=9)
    if 'ineligible' in ch.url():
        raise BridgeError(PAGE_PROFILE_ERROR)
    ch.js(EXPAND)
    time.sleep(1.5)
    rows = ch.json(grab(limit), default=[])
    for r in rows:
        r['group'] = group
        r['group_url'] = f'https://www.facebook.com/groups/{group}'
        if r['url'].startswith('/'):
            r['url'] = 'https://www.facebook.com' + r['url']
        if not r['url']:
            r['url'] = r['group_url']
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--groups', required=True, help='id или слаги через запятую')
    ap.add_argument('--queries', required=True, help='запросы через запятую')
    ap.add_argument('--limit', type=int, default=10, help='постов на пару группа-запрос')
    args = ap.parse_args()

    groups = [g.strip() for g in args.groups.split(',') if g.strip()]
    queries = [q.strip() for q in args.queries.split(',') if q.strip()]

    ch = Chrome()
    posts, errors, seen = [], [], set()
    for g in groups:
        for q in queries:
            try:
                for r in search(ch, g, q, args.limit):
                    key = (r['url'], r['text'][:80])
                    if key in seen:
                        continue
                    seen.add(key)
                    r['query'] = q
                    posts.append(r)
            except BridgeError as e:
                errors.append({'group': g, 'query': q, 'error': str(e)})
                print(json.dumps({'posts': posts, 'errors': errors}, ensure_ascii=False))
                return                       # мост сломан — дальше бессмысленно
            except Exception as e:           # noqa: BLE001 — одна пара не должна валить проход
                errors.append({'group': g, 'query': q, 'error': f'{type(e).__name__}: {e}'})
    print(json.dumps({'posts': posts, 'errors': errors}, ensure_ascii=False))


if __name__ == '__main__':
    main()
