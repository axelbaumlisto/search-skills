"""listing-monitor refresh|seed|check --config <toml>"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from .config import load_config
from .pipeline import default_enrich, default_sources, refresh
from .store import State

URL_RE = re.compile(r"https?://[^\s|)<>\]]+")



def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="listing-monitor")
    p.add_argument("command", choices=["refresh", "seed", "check"])
    p.add_argument("--config", required=True)
    p.add_argument("--dry-run", action="store_true", help="ничего не писать и не отправлять")
    p.add_argument("--no-send", action="store_true")
    p.add_argument("--days", type=int, help="refresh: окно в днях вместо «с прошлого запуска»")
    p.add_argument("--from", dest="src", help="seed: файл, все URL из которого считать виденными")
    a = p.parse_args(argv)
    cfg = load_config(a.config)

    if a.command == "seed":
        st = State.load(cfg.state_path)
        urls = set(URL_RE.findall(Path(a.src).read_text()))
        st.seen |= urls
        st.save()
        print(f"seen += {len(urls)}, всего {len(st.seen)}")
        return 0

    if a.command == "check":
        ok = True
        for name, fetch in default_sources(cfg).items():
            try:
                print(f"{name}: OK, {len(fetch(cfg, None))} объявлений")
            except Exception as e:
                ok = False
                print(f"{name}: FAIL {type(e).__name__}: {e}")
        return 0 if ok else 1

    send = None
    if not (a.no_send or a.dry_run) and cfg.notify:
        from .notify import send as tg_send
        send = lambda text: tg_send(cfg, text)
    res = refresh(cfg, send=send, dry_run=a.dry_run, enrich=default_enrich, since_days=a.days)
    print(res.stats)
    for x in res.matched:
        beds = f"{x.bedrooms} PN | " if cfg.min_bedrooms else ""
        print(f"  {x.price_vnd} | {beds}{x.title[:60]} | {x.url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
