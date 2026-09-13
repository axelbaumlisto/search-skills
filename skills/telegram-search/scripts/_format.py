#!/usr/bin/env python3
"""Render tg_reader.py JSON (stdin) as compact human-readable lines."""
import json
import sys

d = json.load(sys.stdin)
if not d.get("success"):
    print("ERROR:", d.get("error"))
    sys.exit(1)

if "dialogs" in d:
    for x in d["dialogs"]:
        print(f"{x.get('type','?'):11} | {x.get('name')} | "
              f"@{x.get('username') or '-'} | id={x.get('id')}")
    sys.exit(0)

# batch mode nests each answer as {"query": ..., "result": {...}}
blocks = []
for b in d.get("batch") or d.get("queries") or [d]:
    inner = b.get("result") if isinstance(b, dict) and isinstance(b.get("result"), dict) else b
    if isinstance(b, dict) and "query" in b:
        inner = {**inner, "query": inner.get("query") or b.get("query")}
    blocks.append(inner)

for b in blocks:
    res = b.get("results") or []
    print(f"# query={b.get('query')!r} matches={b.get('count')} "
          f"scanned_dialogs={b.get('dialogs_scanned')}")
    if not res:
        print("  (nothing — try --dialogs 300 or a shorter query)")
    for m in res:
        chat = (m.get("chat") or {}).get("name")
        txt = " ".join((m.get("text") or "").split())[:160]
        print(f"  [{m.get('date','')[:10]}] {chat}: {txt}")
        tail = " ".join(x for x in (m.get("author_contact"), m.get("message_link")) if x)
        if tail:
            print(f"      {tail}")
