#!/usr/bin/env python3
"""Самопроверка скиллов homepro-th и globalhouse-th: падает, если сайт сменил разметку."""
import re, subprocess, sys

S = __file__.rsplit("/", 1)[0]
CASES = [
    ("homepro",     ["homepro-th/scripts/hp.sh", "อิฐแก้ว"], 40, 80),                 # стеклоблок ~฿50
    ("globalhouse", ["globalhouse-th/scripts/gh.sh", "category:9236"], 30, 90),      # стеклоблок ~฿50
]

def main() -> int:
    bad = 0
    for name, argv, lo, hi in CASES:
        cmd = [f"{S}/../{argv[0]}", *argv[1:]]
        try:
            out = subprocess.run(cmd, capture_output=True, text=True, timeout=420).stdout
        except Exception as e:
            print(f"FAIL {name}: {e}"); bad += 1; continue
        prices = [int(p.replace(",", "").split(".")[0])
                  for p in re.findall(r"฿\s*([\d,]+(?:\.\d+)?)", out)]
        ok = any(lo <= p <= hi for p in prices)
        print(f"{'OK  ' if ok else 'FAIL'} {name}: цен найдено {len(prices)}"
              + (f", первая {prices[0]}" if prices else "")
              + ("" if ok else f"  (ждали {lo}–{hi})"))
        bad += 0 if ok else 1
    print("ИТОГ:", "всё зелёное" if not bad else f"провалов {bad}")
    return 0 if not bad else 1

if __name__ == "__main__":
    raise SystemExit(main())
