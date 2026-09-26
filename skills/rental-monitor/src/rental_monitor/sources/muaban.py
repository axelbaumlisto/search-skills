"""muaban.net через общий браузер на удалённом хосте (сайт отдаёт карточки только в JS)."""
from __future__ import annotations

import json
import shlex

from ..models import Listing
from ..parse import parse_bedrooms, parse_price_vnd
from ..remote import put_file, run_detached

REMOTE_SCRIPT = r'''
import asyncio, json, sys
from playwright.async_api import async_playwright
JS = """() => { const seen=new Set(), out=[];
 for (const a of document.querySelectorAll('a[href*="-id"]')) {
   const h=a.href.split('?')[0]; if(!/-id\\d+$/.test(h)||seen.has(h)) continue;
   let box=a; for(let i=0;i<6&&box.parentElement;i++){ box=box.parentElement;
     if((box.innerText||'').includes('/tháng')||(box.innerText||'').includes('triệu')) break; }
   seen.add(h); out.push({url:h, text:(box.innerText||'').trim()}); } return out; }"""
async def main(urls):
    async with async_playwright() as p:
        b = await p.chromium.connect_over_cdp("http://localhost:9222")
        pg = await b.contexts[0].new_page()
        res = []
        try:
            for u in urls:
                await pg.goto(u, wait_until="domcontentloaded", timeout=60000)
                await pg.wait_for_timeout(5000)
                res += await pg.evaluate(JS)
        finally:
            await pg.close()
        print(json.dumps(res, ensure_ascii=False))
asyncio.run(main(sys.argv[1:]))
'''
REMOTE_PATH = "/tmp/rental_monitor_muaban.py"


def parse(cards: list[dict]) -> list[Listing]:
    out = []
    for c in cards:
        lines = [s.strip() for s in c.get("text", "").split("\n") if s.strip()]
        if not lines:
            continue
        text = "\n".join(lines)
        price_line = next((s for s in lines if "/tháng" in s or "triệu" in s), "")
        out.append(Listing(source="muaban", url=c["url"], title=lines[0], text=text,
                           price_vnd=parse_price_vnd(price_line), bedrooms=parse_bedrooms(text),
                           kind="expired" if "tin hết hạn" in text.lower() else "unknown",
                           area=next((s for s in lines if "," in s and ("Phường" in s or "Thành phố" in s or "Xã" in s)), "")))
    return out


def fetch(cfg, since=None) -> list[Listing]:
    host = cfg.muaban["remote_host"]
    put_file(host, REMOTE_SCRIPT, REMOTE_PATH)
    out = run_detached(host, f"python3 {REMOTE_PATH} " + " ".join(shlex.quote(u) for u in cfg.muaban["urls"]))
    return parse(json.loads(out[out.find("["):])) if "[" in out else []
