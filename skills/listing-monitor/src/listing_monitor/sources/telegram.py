"""Telegram: глобальный поиск по чатам, в которых состоит research-аккаунт."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from ..models import Listing
from ..parse import is_offer, parse_bedrooms, parse_price_vnd
from ..tg import client


def parse(messages: list[dict], offer: str = "rent", chats: list[str] | None = None) -> list[Listing]:
    """chats — белый список чатов города: сообщения только оттуда, и город считается известным."""
    allow = {c.lower() for c in chats or []}
    out = []
    for m in messages:
        text = m.get("text") or ""
        if not m.get("chat_username") or not is_offer(text, offer):
            continue
        if allow and m["chat_username"].lower() not in allow:
            continue
        out.append(Listing(
            source="telegram", url=f"https://t.me/{m['chat_username']}/{m['id']}", title=text.split("\n", 1)[0][:80],
            text=text, price_vnd=parse_price_vnd(text), bedrooms=parse_bedrooms(text), kind=offer,
            posted=datetime.fromisoformat(m["date"]),
            group_url=f"https://t.me/{m['chat_username']}", geo_bound=bool(allow), group_name=m.get("chat_title") or "", contact=f"@{m['author']}" if m.get("author") else m.get("chat_title", "")))
    return out


async def _search(session: str, queries: list[str], since: datetime) -> list[dict]:
    from telethon import functions, types
    c = await client(session)
    rows: list[dict] = []
    try:
        for q in queries:
            r = await c(functions.messages.SearchGlobalRequest(
                q=q, filter=types.InputMessagesFilterEmpty(), min_date=since, max_date=None, offset_rate=0,
                offset_peer=types.InputPeerEmpty(), offset_id=0, limit=100))
            chats = {x.id: x for x in r.chats}
            users = {x.id: x for x in r.users}
            for m in r.messages:
                cid = getattr(m.peer_id, "channel_id", None) or getattr(m.peer_id, "chat_id", None)
                ch = chats.get(cid)
                u = users.get(getattr(m.from_id, "user_id", None))
                rows.append({"id": m.id, "date": m.date.isoformat(), "chat_username": getattr(ch, "username", None),
                             "chat_title": getattr(ch, "title", ""), "author": getattr(u, "username", None),
                             "text": m.message or ""})
    finally:
        await c.disconnect()
    return rows


def fetch(cfg, since=None) -> list[Listing]:
    since = since or datetime.now(timezone.utc) - timedelta(days=cfg.telegram.get("days", 3))
    return parse(asyncio.run(_search(cfg.telegram["session"], cfg.telegram["queries"], since)), cfg.offer, cfg.telegram.get("chats"))
