#!/usr/bin/env python3
"""Поиск постов в группах Facebook на удалённом хосте (playwright по CDP).

Запускается НЕ на ноутбуке, а на сервере с постоянно залогиненным Chrome —
там же, где работает fb_marketplace.py. Так источник перестаёт зависеть от
того, открыт ли браузер на ноутбуке и не спит ли он.

Файл доставляется на хост автоматически (`sources/fb_groups.py`), вместе с
ним кладётся `lm_fb_dom.json` — селекторы из `listing_monitor/fb_dom.py`,
единые для локального и удалённого пути.

    python3 fb_group_search_remote.py --groups a,b --queries "x,y" --limit 8

Вывод — JSON: {"posts": [{group, group_url, url, author, text, time}], "errors": []}
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
from pathlib import Path

CDP = os.environ.get('FB_CDP_ENDPOINT', 'http://localhost:9222')
DOM_PATH = Path(__file__).with_name('lm_fb_dom.json')


# Facebook иногда отвечает дольше минуты. Ждать «полной загрузки» бессмысленно:
# лента догружается бесконечно, поэтому ждём только DOM и потом фиксированную паузу.
GOTO_TIMEOUT_MS = 75_000
SETTLE_MS = 9_000
RETRIES = 2                 # первая попытка + одна повторная


def _open(page, url: str) -> None:
    """Открыть страницу, повторив один раз при таймауте.

    Замер 27.09.2026: при 45 с падала примерно каждая пятнадцатая пара
    «группа × запрос» — и её объявления просто терялись до следующего прохода.
    """
    last = None
    for attempt in range(RETRIES):
        try:
            page.goto(url, wait_until='domcontentloaded', timeout=GOTO_TIMEOUT_MS)
            page.wait_for_timeout(SETTLE_MS)
            return
        except Exception as e:                                  # noqa: BLE001
            last = e
            if attempt + 1 < RETRIES:
                page.wait_for_timeout(4000)                     # дать серверу выдохнуть
    raise last


def search(page, dom: dict, group: str, query: str, limit: int) -> list[dict]:
    url = dom['search_url'].format(group=group, query=urllib.parse.quote(query))
    _open(page, url)
    if 'ineligible' in page.url:
        raise RuntimeError(dom['page_profile_error'])
    page.evaluate(dom['expand'])
    page.wait_for_timeout(1500)
    rows = page.evaluate(dom['grab'].replace('LIMIT', str(limit))) or []
    for r in rows:
        r['group'] = group
        r['group_url'] = f'https://www.facebook.com/groups/{group}'
        if (r.get('url') or '').startswith('/'):
            r['url'] = 'https://www.facebook.com' + r['url']
        if not r.get('url'):
            r['url'] = r['group_url']
    return rows


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--groups', required=True)
    ap.add_argument('--queries', required=True)
    ap.add_argument('--limit', type=int, default=10)
    ap.add_argument('--budget-sec', type=int, default=900,
                    help='общий бюджет: новые пары не начинаем, отдаём найденное')
    a = ap.parse_args()

    dom = json.loads(DOM_PATH.read_text(encoding='utf-8'))
    groups = [g.strip() for g in a.groups.split(',') if g.strip()]
    queries = [q.strip() for q in a.queries.split(',') if q.strip()]

    from playwright.sync_api import sync_playwright

    posts, errors, seen = [], [], set()
    deadline = time.monotonic() + a.budget_sec
    with sync_playwright() as pw:
        browser = pw.chromium.connect_over_cdp(CDP)
        ctx = browser.contexts[0] if browser.contexts else browser.new_context()
        page = ctx.new_page()
        try:
            for g in groups:
                for q in queries:
                    # Лучше отдать девять групп из десяти, чем упереться в общий
                    # таймаут и не отдать ничего.
                    if time.monotonic() > deadline:
                        errors.append({'group': g, 'query': q, 'error': 'бюджет времени исчерпан'})
                        continue
                    try:
                        for r in search(page, dom, g, q, a.limit):
                            key = (r['url'], r['text'][:80])
                            if key in seen:
                                continue
                            seen.add(key)
                            r['query'] = q
                            posts.append(r)
                    except Exception as e:                    # noqa: BLE001
                        msg = f'{type(e).__name__}: {e}'
                        errors.append({'group': g, 'query': q, 'error': msg})
                        if 'ineligible' in msg or "Pages can't" in msg:
                            break                             # профиль не тот — дальше бессмысленно
        finally:
            page.close()
    json.dump({'posts': posts, 'errors': errors}, sys.stdout, ensure_ascii=False)
    print()


if __name__ == '__main__':
    main()
