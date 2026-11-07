#!/usr/bin/env python3
"""Global House: поиск/категория -> (name, price). Работает на хосте с CDP-браузером.

Проверено 17.10.2026:
  * поиск — параметр keyword= (с q= страница отдаёт только «похожие товары»);
  * выдача постраничная: &page=1..N по ~40 карточек, страницы не пересекаются,
    последняя неполная, дальше 0 — сумма сходится со счётчиком «พบ N รายการ»;
  * цена в карточке текстом «55 .-» (у акции «159 .- 180.-»), финальные подставляет
    POST /api/product/branch-saleprice и они зависят от филиала (кука gbh_branch).

Usage: gh.py "<query|category:ID>" [--branch GH-xxx] [--max-pages N]
"""
import json, re, sys, urllib.parse
from playwright.sync_api import sync_playwright

CATEGORIES = {"стеклоблок": "9236", "glassblock": "9236", "арматура": "90009",
              "rebar": "90009", "เหล็กเส้น": "90009"}

# цена ищется по предкам ссылки: в самой <a> её нет, она в карточке уровнем выше
EXTRACT = """() => {
  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href*="/product/"]')) {
    const href = a.getAttribute('href');
    if (!href || seen.has(href)) continue;
    let node = a, price = null, text = '';
    for (let up = 0; up < 6 && node; up++, node = node.parentElement) {
      const t = (node.innerText || '').replace(/\\s+/g, ' ').trim();
      if (t.length > 400) break;
      const m = t.match(/([\\d,]{2,}(?:\\.\\d+)?)\\s*\\.-/);
      if (m) { price = m[1]; text = t; break; }
    }
    if (!price) continue;
    const name = text.split(/[\\d,]{2,}(?:\\.\\d+)?\\s*\\.-/)[0]
      .replace(/ผ่อน[^|]*$/, '').replace(/มีขั้นต่ำ|Preorder|สินค้าหมด/g, '').trim();
    if (name.length < 4) continue;
    seen.add(href);
    out.push({name: name.slice(0, 110), price: price, url: new URL(href, location.origin).href});
  }
  return out;
}"""


def resolve_category(query: str):
    import urllib.request
    try:
        with urllib.request.urlopen("https://globalhouse.co.th/api/category/menufull", timeout=30) as r:
            data = json.loads(r.read().decode())
    except Exception:
        return None
    words = [w for w in re.split(r"\s+", query.strip().lower()) if w]
    best = None
    for cat in data.get("categoryData", []):
        nodes = [cat] + (cat.get("second_cat_items") or [])
        nodes += [x for sc in (cat.get("second_cat_items") or [])
                  for x in (sc.get("third_cat_items") or [])]
        for node in nodes:
            name = (node.get("catname") or "").lower()
            if name and all(w in name for w in words):
                if best is None or len(name) < len(best[1]):
                    best = (node.get("entity_id"), name)
    return best[0] if best else None


def url_for(arg: str):
    if arg.startswith("category:"):
        return "https://globalhouse.co.th/category/" + arg.split(":", 1)[1], "category"
    cid = CATEGORIES.get(arg.strip().lower())
    if cid:
        return f"https://globalhouse.co.th/category/{cid}", "category"
    return "https://globalhouse.co.th/search?keyword=" + urllib.parse.quote(arg), "search"


def collect(pg, base: str, max_pages: int):
    """Идём по &page=1..N, пока страница не вернёт 0 новых карточек."""
    rows, seen, page, total_line = [], set(), 1, ""
    while page <= max_pages:
        sep = "&" if "?" in base else "?"
        pg.goto(f"{base}{sep}page={page}", wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_timeout(4500)
        pg.mouse.wheel(0, 1500); pg.wait_for_timeout(1200)      # дожить до подстановки цен
        if not total_line:
            body = pg.evaluate("document.body.innerText")
            total_line = next((l.strip() for l in body.split("\n")
                               if re.search(r"พบ\s*[\d,]+\s*รายการ", l)), "")
        got = pg.evaluate(EXTRACT) or []
        fresh = [r for r in got if r["url"] not in seen]
        if not fresh:
            break
        for r in fresh:
            seen.add(r["url"])
        rows.extend(fresh)
        page += 1
    return rows, total_line, page - 1


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("--")]
    branch, max_pages = None, 30
    for i, a in enumerate(argv[1:]):
        if a == "--branch" and i + 2 <= len(argv) - 1:
            branch = argv[i + 2]
        if a == "--max-pages" and i + 2 <= len(argv) - 1:
            max_pages = int(argv[i + 2])
    query = args[0] if args else "category:90009"
    base, mode = url_for(query)

    out = {"url": base, "branch": branch, "rows": [], "note": "", "pages": 0,
           "total": "", "debug_len": 0}
    for attempt in (1, 2):
        try:
            with sync_playwright() as p:
                b = p.chromium.connect_over_cdp("http://127.0.0.1:9222")
                ctx = b.contexts[0]
                old = next((c["value"] for c in ctx.cookies("https://globalhouse.co.th")
                            if c["name"] == "gbh_branch"), None)
                if branch:
                    ctx.add_cookies([{"name": "gbh_branch", "value": branch,
                                      "domain": ".globalhouse.co.th", "path": "/"}])
                pg = ctx.new_page()
                try:
                    rows, total, pages = collect(pg, base, max_pages)
                    if not rows and mode == "search":
                        cid = resolve_category(query)
                        if cid:
                            base = f"https://globalhouse.co.th/category/{cid}"
                            rows, total, pages = collect(pg, base, max_pages)
                    now = [c["value"] for c in ctx.cookies("https://globalhouse.co.th")
                           if c["name"] == "gbh_branch"]
                    out.update(url=base, rows=rows, pages=pages, total=total,
                               branch=(now[0] if now else (old or "")),
                               debug_len=len(rows))
                finally:
                    pg.close()
                    if branch and old:
                        ctx.add_cookies([{"name": "gbh_branch", "value": old,
                                          "domain": ".globalhouse.co.th", "path": "/"}])
            break
        except Exception as e:
            out["note"] = f"попытка {attempt} упала: {str(e)[:120]}"
            if attempt == 2:
                break
    if not out["rows"] and not out["note"]:
        out["note"] = ("  ничего не нашлось — другое слово или категория: "
                       "gh.py category:<id> (9236 стеклоблок, 90009 арматура)")
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv)
