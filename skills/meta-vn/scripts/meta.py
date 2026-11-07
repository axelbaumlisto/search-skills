#!/usr/bin/env python3
"""meta.vn — поиск профессионального кухонного оборудования с размерами и ценой.

Зачем. Поставщики в Zalo присылают по одной позиции и без габаритов, а при
расстановке кухни размер важнее цены: холодильный стол 1800×700 рядом с мойкой
1800×750 даёт уступ, в который течёт вода. meta.vn держит каталог с полными
ТТХ, отдаёт обычный HTML и читается без браузера.

  meta.py cat ban-mat-ban-dong-c3462          список категории с ценами
  meta.py cat <slug> --max 20000000           только дешевле N донгов
  meta.py item /ban-mat-kmax-kmi1807080-p115060   полные ТТХ одной позиции
  meta.py cats                                шпаргалка по категориям
  meta.py find "ban mat 1m8"                  поиск по названиям внутри категорий

Размеры в ТТХ meta.vn пишут как «Rộng x sâu x cao» (ширина × глубина × высота),
а в названии карточки — как «1800 x 700 x 800mm». Порядок разный, поэтому
item показывает обе строки как есть, без домысливания.
"""
import argparse
import html
import json
import re
import sys
import urllib.request

BASE = 'https://meta.vn'
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0 Safari/537.36')

# Категории, которые реально нужны кухне. Слаг — хвост URL на meta.vn.
CATS = {
    'ban-mat': ('ban-mat-ban-dong-c3462', 'Холодильные и морозильные столы'),
    'tu-mat': ('tu-mat-tu-dong-cong-nghiep-c3461', 'Холодильные и морозильные шкафы'),
    'tu-dong': ('tu-dong-cong-nghiep-c3practice', 'Морозильные шкафы'),
    'bep-cong-nghiep': ('bep-cong-nghiep-c1133', 'Плиты и тепловое'),
    'chau-rua': ('chau-rua-cong-nghiep-c3466', 'Мойки производственные'),
    'ban-inox': ('ban-inox-c3465', 'Столы из нержавейки'),
    'ke-inox': ('ke-inox-c3467', 'Стеллажи из нержавейки'),
    'tu-com': ('tu-nau-com-cong-nghiep-c1135', 'Рисоварки промышленные'),
    'may-rua-bat': ('may-rua-bat-cong-nghiep-c1952', 'Посудомоечные машины'),
}


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode('utf-8', 'ignore')


def money(s):
    return int(re.sub(r'\D', '', s) or 0)


def fmt(n):
    return f'{n:,}'.replace(',', ' ') + ' ₫' if n else '—'


def parse_cat(page):
    """Карточки категории: ссылка, название, цена, старая цена."""
    out = []
    for m in re.finditer(r'<a[^>]+href="(/[a-z0-9\-]+-p\d+)"[^>]*title="([^"]{10,200})"', page):
        url, title = m.group(1), html.unescape(m.group(2))
        title = re.sub(r'^Chi tiết\s*', '', title).strip()
        tail = page[m.end():m.end() + 2500]
        price = re.search(r'class="product-price-meta"[^>]*>\s*([\d.]+)', tail)
        old = re.search(r'class="product-price-old"[^>]*>\s*([\d.]+)', tail)
        if any(o['url'] == url for o in out):
            continue
        out.append({
            'url': url, 'name': title,
            'price': money(price.group(1)) if price else 0,
            'old': money(old.group(1)) if old else 0,
        })
    return out


# Что вытаскиваем из таблицы ТТХ. Ключ — как пишет meta.vn.
SPEC_KEYS = ['Kích thước', 'Trọng lượng', 'Dung tích', 'Công suất', 'Nhiệt độ',
             'Chất liệu', 'Loại gas', 'Nguồn điện', 'Bảo hành', 'Sản xuất tại',
             'Xuất xứ', 'Kiểu', 'Chiều dài', 'Bánh xe', 'Công nghệ làm lạnh',
             'Chất liệu dàn lạnh', 'Số cánh']


def parse_item(page):
    txt = re.sub(r'<script[\s\S]*?</script>|<style[\s\S]*?</style>', ' ', page)
    txt = html.unescape(re.sub(r'<[^>]+>', ' ', txt))
    txt = re.sub(r'[ \t]+', ' ', txt)
    d = {}
    name = re.search(r'<h1[^>]*>([^<]{10,200})</h1>', page)
    if name:
        d['name'] = html.unescape(name.group(1)).strip()
    p = re.search(r'"price"\s*:\s*"?(\d{6,12})', page)
    d['price'] = int(p.group(1)) if p else 0
    # Значение ТТХ — это текст ДО следующего ключа. Поиск каждого ключа по
    # отдельности давал кашу: «Nhiệt độ: 0-10 độ C Bánh xe di chuyển» — в
    # значение попадал заголовок соседней строки. Поэтому сначала собираем
    # позиции всех ключей, потом режем текст между ними.
    hits = []
    for k in SPEC_KEYS:
        for m in re.finditer(r'(?<![\wÀ-ỹ])' + re.escape(k) + r'\s*:?\s', txt):
            hits.append((m.start(), m.end(), k))
    hits.sort()
    specs = {}
    for i, (st, en, k) in enumerate(hits):
        nxt = hits[i + 1][0] if i + 1 < len(hits) else len(txt)
        v = txt[en:nxt].strip(' :–-\n')
        v = re.sub(r'\s+', ' ', v)
        if v and len(v) < 90 and k not in specs:
            specs[k] = v
    d['specs'] = specs
    return d


def cat_all(slug, max_pages=12):
    """Все страницы категории.

    Пагинация у meta.vn — параметр ?p=N. Ни ?page=N, ни /trang-N не работают:
    первый молча отдаёт ту же первую страницу (и каталог выглядит вдвое
    меньше, чем он есть), второй отвечает 301. Проверено 14.10.2026 на
    ban-mat: 32 карточки на странице при заявленных 63 товарах.
    """
    seen, rows = set(), []
    for n in range(1, max_pages + 1):
        url = f'{BASE}/{slug}' + (f'?p={n}' if n > 1 else '')
        try:
            chunk = parse_cat(get(url))
        except Exception:
            break
        fresh = [r for r in chunk if r['url'] not in seen]
        if not fresh:
            break
        for r in fresh:
            seen.add(r['url'])
        rows += fresh
    return rows


def cmd_cat(a):
    slug = CATS.get(a.slug, (a.slug,))[0]
    rows = cat_all(slug)
    rows = [r for r in rows if r['price']]
    if a.min:
        rows = [r for r in rows if r['price'] >= a.min]
    if a.max:
        rows = [r for r in rows if r['price'] <= a.max]
    rows.sort(key=lambda r: r['price'])
    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1))
        return
    print(f'{len(rows)} позиций в {slug}\n')
    for r in rows:
        disc = f"  (было {fmt(r['old'])})" if r['old'] and r['old'] > r['price'] else ''
        print(f"{fmt(r['price']):>14}  {r['name'][:84]}{disc}")
        print(f"{'':14}  {BASE}{r['url']}")


def cmd_item(a):
    url = a.url if a.url.startswith('http') else BASE + a.url
    d = parse_item(get(url))
    if a.json:
        print(json.dumps(d, ensure_ascii=False, indent=1))
        return
    print(d.get('name', '?'))
    print(f"цена: {fmt(d.get('price', 0))}\n")
    for k, v in d['specs'].items():
        print(f'  {k:24} {v}')


def cmd_find(a):
    q = a.query.lower().split()
    seen = []
    for key, (slug, ru) in CATS.items():
        try:
            rows = cat_all(slug)
        except Exception:
            continue
        for r in rows:
            n = r['name'].lower()
            if all(w in n for w in q) and r['price']:
                r['cat'] = ru
                seen.append(r)
    seen.sort(key=lambda r: r['price'])
    if not seen:
        print('ничего не нашлось; попробуй другие слова или meta.py cats')
        return
    for r in seen:
        print(f"{fmt(r['price']):>14}  {r['name'][:80]}")
        print(f"{'':14}  {BASE}{r['url']}")


def cmd_cats(_):
    for k, (slug, ru) in CATS.items():
        print(f'  {k:18} {ru:42} {slug}')


def main():
    p = argparse.ArgumentParser(description='meta.vn — кухонное оборудование')
    sub = p.add_subparsers(dest='cmd', required=True)
    c = sub.add_parser('cat'); c.add_argument('slug')
    c.add_argument('--min', type=int, default=0); c.add_argument('--max', type=int, default=0)
    c.add_argument('--json', action='store_true'); c.set_defaults(fn=cmd_cat)
    i = sub.add_parser('item'); i.add_argument('url')
    i.add_argument('--json', action='store_true'); i.set_defaults(fn=cmd_item)
    f = sub.add_parser('find'); f.add_argument('query'); f.set_defaults(fn=cmd_find)
    s = sub.add_parser('cats'); s.set_defaults(fn=cmd_cats)
    a = p.parse_args()
    try:
        a.fn(a)
    except urllib.error.HTTPError as e:
        print(f'meta.vn ответил {e.code} — проверь слаг категории (meta.py cats)', file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
