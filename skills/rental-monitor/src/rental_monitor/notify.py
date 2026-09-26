"""Отправка сообщения получателю из конфига."""
from __future__ import annotations

import asyncio

from .tg import client


async def _send(session: str, peer: int | str, text: str) -> int:
    c = await client(session)
    try:
        m = await c.send_message(peer, text, link_preview=False)
        return m.id
    finally:
        await c.disconnect()


def send(cfg, text: str) -> int:
    return asyncio.run(_send(cfg.notify["session"], cfg.notify["peer_id"], text))
