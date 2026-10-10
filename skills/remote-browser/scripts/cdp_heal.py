#!/usr/bin/env python3
"""Run on the remote host before a Playwright job: close hung blank tabs.

Playwright's connect_over_cdp attaches to every open page and waits for each to
answer. One frozen tab (seen: a stuck about:blank) makes the connect hang until
its timeout, so every browse/marketplace job dies with "no content". This probes
each page with Runtime.evaluate and closes the ones that do not answer — but only
blank pages; a frozen real page is reported, never closed (it may hold a login).

argv: [cdp_port]  (default 9222). Needs the `websockets` package.
"""
import asyncio
import json
import sys
import urllib.request

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9222
BASE = f"http://localhost:{PORT}"
BLANK = ("about:blank", "chrome://newtab/", "chrome://new-tab-page/")


async def alive(ws_url: str) -> bool:
    import websockets
    try:
        async with websockets.connect(ws_url, max_size=None, open_timeout=3) as ws:
            await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate",
                                      "params": {"expression": "1"}}))
            while True:
                msg = json.loads(await asyncio.wait_for(ws.recv(), 3))
                if msg.get("id") == 1:
                    return True
    except Exception:
        return False


async def main() -> None:
    pages = [t for t in json.load(urllib.request.urlopen(f"{BASE}/json", timeout=5))
             if t.get("type") == "page" and t.get("webSocketDebuggerUrl")]
    for t in pages:
        if await alive(t["webSocketDebuggerUrl"]):
            continue
        if t["url"] in BLANK:
            urllib.request.urlopen(f"{BASE}/json/close/{t['id']}", timeout=5).read()
            print(f"cdp_heal: closed hung blank tab {t['id'][:8]}", file=sys.stderr)
        else:
            print(f"cdp_heal: WARNING hung tab {t['url'][:80]} — CDP connect may stall",
                  file=sys.stderr)


if __name__ == "__main__":
    asyncio.run(main())
