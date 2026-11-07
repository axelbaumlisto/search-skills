#!/usr/bin/env python3
"""Нормализованный вывод: принимает список [{name,price,url}] или {url,rows,note}."""
import json, sys

def main():
    raw = sys.stdin.read().strip()
    if not raw:
        print("  (пусто)"); return
    try:
        d = json.loads(raw)
    except Exception:
        print("  (не JSON):", raw[:200]); return
    note = ""
    if isinstance(d, dict):
        note = d.get("note") or ""
        if d.get("url"):
            pages = d.get("pages")
        print(f"  {d['url']}" + (f"  (страниц: {pages})" if pages else "")
              + (f"  | {d['total']}" if d.get("total") else "")
              + (f"  | branch {d['branch']}" if d.get("branch") else ""))
        rows = d.get("rows") or []
    else:
        rows = d
    print(f"  найдено {len(rows)}")
    for r in rows[:12]:
        print(f"  ฿{str(r.get('price')):>9}  {str(r.get('name'))[:74]}")
        if r.get("url"):
            print(f"             {r['url'][:112]}")
    if note:
        print(note)

if __name__ == "__main__":
    main()
