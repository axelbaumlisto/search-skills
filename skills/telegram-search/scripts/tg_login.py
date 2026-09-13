#!/usr/bin/env python3
"""Authorize a Telegram session for tg_reader.py.

    tg_login.py                 # session from TG_SESSION (default "default")
    tg_login.py --account research

Telegram sends the code *inside Telegram* (or by SMS if you have no other
session). 2FA password, when set, is asked interactively and never stored.
The result is a .session file in $TG_SESSION_DIR — treat it like a password:
anyone holding it is logged into the account.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

from telethon import TelegramClient

sys.path.insert(0, str(Path(__file__).parent))
from tg_reader import SESSION_DIR, credentials, load_dotenv, HOME  # noqa: E402


async def main(account: str) -> None:
    api_id, api_hash, session = credentials(account)
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    path = SESSION_DIR / session
    phone = os.environ.get(f"TG_PHONE_{account.upper()}") or os.environ.get("TG_PHONE")
    client = TelegramClient(str(path), api_id, api_hash)
    await client.start(phone=phone or (lambda: input("phone (+7…): ").strip()))
    me = await client.get_me()
    print(f"authorized as @{me.username or me.id} -> {path}.session")
    await client.disconnect()


if __name__ == "__main__":
    load_dotenv(Path(os.environ.get("SEARCH_SKILLS_ENV") or (HOME / ".env")))
    p = argparse.ArgumentParser()
    p.add_argument("--account", default="default")
    asyncio.run(main(p.parse_args().account))
