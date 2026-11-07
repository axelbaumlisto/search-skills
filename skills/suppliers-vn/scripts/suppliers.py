#!/usr/bin/env python3
"""suppliers-vn — поставщики и подрядчики во Вьетнаме.

  places  — компании через Google Places: рейтинг, отзывы, телефон, адрес. Для подрядчиков.
  chotot  — поиск по Chợ Tốt через браузер (API игнорирует keyword). Для б/у техники и мебели.
  vatgia  — листинг категории Vật Giá. Поиск и карточки отдают HTTP 500 (проверено 21.10.2026).

  suppliers.py places "nhôm kính" --city "Da Nang" --min-reviews 5
  suppliers.py chotot "tủ mát" --region "Đà Nẵng" --min-price 1000000
  suppliers.py vatgia --cat 2748 --kw kính
"""
import argparse, json, os, re, subprocess, sys, urllib.parse

SKILLS_HOME = os.path.expanduser(os.environ.get("PI_SKILLS_HOME", "~/.pi/agent/skills"))
GP = os.environ.get("GOOGLE_PLACES_CLI", os.path.join(SKILLS_HOME, "google-places/scripts/places.sh"))
BS = os.environ.get("BROWSER_SCOUT_CLI", os.path.join(SKILLS_HOME, "browser-scout/scripts/browse.sh"))

CITY_SLUG = {"Đà Nẵng": "da-nang", "Da Nang": "da-nang", "Hà Nội": "ha-noi",
             "Tp Hồ Chí Minh": "tp-ho-chi-minh"}
CITIES = ("Đà Nẵng", "Hà Nội", "Tp Hồ Chí Minh", "Toàn quốc", "Bình Dương")
VG_CATS = {"2748": "Công nghiệp, xây dựng", "3205": "Nội, ngoại thất",
           "7184": "Đồ gia dụng", "15030": "Sửa chữa & bảo dưỡng điện máy"}
VG_SLUG = {"2748": "cong-nghiep-xay-dung", "3205": "noi-ngoai-that",
           "7184": "do-gia-dung", "15030": "sua-chua-bao-duong-dien-may"}


def sh(cmd, timeout=180):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout


def places(trade, city, limit, min_reviews):
    q = f"{trade} {city}".strip()
    out = sh([GP, q, "--limit", str(limit)])
    rows = []
    pat = re.compile(r"^(?P<name>.+?)\s+[—·]\s+(?P<rating>\d\.\d)★?\s*\((?P<rev>\d+)\)")
    for line in out.splitlines():
        m = pat.match(line.strip())
        if m and int(m["rev"]) >= min_reviews:
            rows.append({"name": m["name"].strip(), "rating": float(m["rating"]),
                         "reviews": int(m["rev"])})
    rows.sort(key=lambda r: (-r["rating"], -r["reviews"]))
    return rows


def chotot(keyword, region, min_price, max_price, limit):
    slug = CITY_SLUG.get(region, "")
    base = "https://www.chotot.com/mua-ban" + (f"-{slug}" if slug else "")
    url = base + "?q=" + urllib.parse.quote(keyword)
    raw = [l.strip() for l in sh([BS, url, "--chars", "16000"]).splitlines() if l.strip()]
    price_re = re.compile(r"^[\d\.,]+\s*đ$")
    time_re = re.compile(r"^(\d+ (giờ|phút|ngày|tuần|tháng) trước|Hôm qua|Hôm nay)$")
    junk_re = re.compile(r"^(Đã sử dụng|Mới|Tất cả|Cá nhân|Bán chuyên|Lọc|Giá|Dạng lưới|"
                         r"> \d+ lít|< \d+ lít|\d+ - \d+ lít|\d+|Tin nổi bật|Liên quan trước)$")
    rows = []
    for i, l in enumerate(raw):
        if not price_re.match(l):
            continue
        title = ""
        for k in range(i - 1, max(i - 7, -1), -1):
            cand = raw[k]
            if time_re.match(cand):
                break
            if junk_re.match(cand):
                continue
            title = cand
            break
        price = int(re.sub(r"\D", "", l) or 0)
        if title.startswith(("Đã sử dụng", "Mới ")) or not title or price < min_price or (max_price and price > max_price):
            continue
        tail = raw[i + 1:i + 5]
        area = next((x for x in tail if x in CITIES or x.startswith("Q. ")), "")
        seller = next((x for x in tail if x not in CITIES and not x.startswith(("Q. ", "(", "Bấm", "Chat"))), "")
        rows.append({"title": title, "price": price, "area": area, "seller": seller})
    return rows[:limit]


def vatgia(cat, kw, chars):
    url = f"https://vatgia.com/raovat/{cat}/{VG_SLUG[cat]}.html"
    txt = sh([BS, url, "--chars", str(chars)])
    if any(x in txt for x in ("Symfony Exception", "HTTP 500", "mysqli_sql_exception")) or len(txt.strip()) < 300:
        return None, "Vật Giá недоступен: HTTP 500 в поиске и карточках (Sphinx лежит). Проверено 21.10.2026"
    lines = [l.strip() for l in txt.splitlines() if l.strip()]
    time_re = re.compile(r"(giờ|phút|ngày|tuần|tháng) trước$")
    blocks, cur = [], []
    for l in lines[6:]:
        cur.append(l)
        if time_re.search(l):
            blocks.append(cur)
            cur = []
    rows = []
    for b in blocks:
        title = b[0]
        price = next((x for x in b if x.endswith("₫")), "")
        city = next((x for x in b if x in CITIES), "")
        phone = next((x for x in b if "***" in x), "")
        seller = next((x for x in b if x not in (title, price, city, phone) and not time_re.search(x)), "")
        if kw and kw.lower() not in (title + " " + seller).lower():
            continue
        rows.append({"title": title[:110], "price": price, "seller": seller[:70],
                     "phone": phone, "city": city})
    return rows, None


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("places"); p.add_argument("trade")
    p.add_argument("--city", default="Da Nang"); p.add_argument("--limit", type=int, default=20)
    p.add_argument("--min-reviews", type=int, default=0); p.add_argument("--json", action="store_true")
    c = sub.add_parser("chotot"); c.add_argument("keyword"); c.add_argument("--region", default="")
    c.add_argument("--min-price", type=int, default=0); c.add_argument("--max-price", type=int, default=0)
    c.add_argument("--limit", type=int, default=20); c.add_argument("--json", action="store_true")
    v = sub.add_parser("vatgia"); v.add_argument("--cat", default="2748", choices=sorted(VG_CATS))
    v.add_argument("--kw", default=""); v.add_argument("--chars", type=int, default=20000)
    v.add_argument("--json", action="store_true")
    a = ap.parse_args()

    if a.cmd == "places":
        rows = places(a.trade, a.city, a.limit, a.min_reviews)
    elif a.cmd == "chotot":
        rows = chotot(a.keyword, a.region, a.min_price, a.max_price, a.limit)
    else:
        rows, err = vatgia(a.cat, a.kw, a.chars)
        if err:
            print(err); sys.exit(2)

    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=1)); return
    if not rows:
        print("ничего не найдено"); return
    for r in rows:
        if a.cmd == "places":
            print(f"{r['rating']:.1f}★ ({r['reviews']:>4})  {r['name']}")
        elif a.cmd == "chotot":
            print(f"{r['price']:>12,}  {r['title'][:68]}  | {r['area']} | {r['seller']}")
        else:
            print(f"{r['price']:>14}  {r['title'][:70]}  | {r['city']} | {r['phone']}")


if __name__ == "__main__":
    main()
