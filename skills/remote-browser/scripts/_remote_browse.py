#!/usr/bin/env python3
"""Run on the remote host: attach to the logged-in Chrome over CDP, open a URL, dump text/HTML.

argv: <url> <mode:text|html> <chars> <screenshot_path|-> [wait_ms]
"""
import html as H
import re
import sys

from playwright.sync_api import sync_playwright

url, mode, chars, shot = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
settle_ms = int(sys.argv[5]) if len(sys.argv) > 5 else 6000

with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp("http://localhost:9222")
    ctx = browser.contexts[0] if browser.contexts else browser.new_context()
    page = ctx.new_page()
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        try:
            page.wait_for_load_state("networkidle", timeout=settle_ms)
        except Exception:
            pass  # networkidle never fires on chat/socket-heavy pages
        print(f"# url={page.url}", file=sys.stderr)
        print(f"# title={page.title()!r}", file=sys.stderr)
        if shot != "-":
            page.screenshot(path=shot, full_page=False)
            print(f"# screenshot={shot}", file=sys.stderr)
        if mode == "html":
            sys.stdout.write(page.content()[: chars * 4])
        else:
            txt = page.evaluate("() => document.body ? document.body.innerText : ''")
            if not txt.strip():
                raw = page.content()
                raw = re.sub(r"<(script|style|noscript|svg)[^>]*>.*?</\1>",
                             " ", raw, flags=re.S | re.I)
                txt = H.unescape(re.sub(r"<[^>]+>", " ", raw))
            txt = "\n".join(line.strip() for line in txt.splitlines() if line.strip())
            sys.stdout.write(txt[:chars])
    finally:
        page.close()
