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

# из карточки поста: текст, автор, ссылка на пост
GRAB = """
[].slice.call(document.querySelectorAll('[data-ad-rendering-role="story_message"]'))
  .map(function(m){
    var card = m.closest('div[role="article"]') || m.parentElement;
    // В выдаче поиска и в ленте Facebook вырезает permalink: у метки времени
    // остаётся href="?__cft__[0]=...". Зато ссылка на фото поста живая и ведёт
    // к тому же посту («This photo is from a post → View Post»).
    var photo = card ? card.querySelector('a[href*="/photo/?fbid="]') : null;
    var href = photo ? photo.getAttribute('href').split('&__cft__')[0] : '';
    var who = card ? card.querySelector('h2 a, h3 a, strong a') : null;
    var t = card ? card.querySelector('abbr, a[href*="__cft__"] span') : null;
    return {
      text: (m.innerText||'').replace(/\\s+/g,' ').trim().slice(0,1500),
      url: href,
      author: who ? (who.innerText||'').trim().slice(0,60) : '',
      time: t ? (t.innerText||'').trim().slice(0,30) : ''
    };
  }).filter(function(x){return x.text.length > 30}).slice(0, LIMIT)
"""


EXPAND = ("(function(){var c=0;"
          "[].slice.call(document.querySelectorAll('div[role=\"button\"],span[role=\"button\"]'))"
          ".forEach(function(b){var t=(b.innerText||'').trim();"
          "if(t==='See more'||t==='Xem thêm'||t==='Ещё'){try{b.click();c++}catch(e){}}});"
          "return c})()")


def search(ch: Chrome, group: str, query: str, limit: int) -> list[dict]:
    url = (f'https://www.facebook.com/groups/{group}/search/'
           f'?q={urllib.parse.quote(query)}')
    ch.goto(url, settle=9)
    if 'ineligible' in ch.url():
        raise BridgeError('Facebook отвечает "Pages can\'t use Marketplace" — '
                          'в Chrome активна Страница, переключись на личный профиль')
    # Facebook сворачивает длинный пост кнопкой «See more», а цену пишут в конце —
    # без раскрытия 23 из 31 поста уходили в отсев «нет цены» (замер 27.09.2026).
    ch.js(EXPAND)
    time.sleep(1.5)
    rows = ch.json(GRAB.replace('LIMIT', str(limit)), default=[])
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
