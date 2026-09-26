"""Общий Telegram-клиент (Telethon) для источника и для отправки. Сессии уже авторизованы.

Ключи API: TG_API_ID/TG_API_HASH (как в остальных скиллах репо) или TELEGRAM_API_ID/HASH.
Откуда берутся: окружение, `env_file` из конфига поиска, иначе ~/.config/search-skills/.env."""
from __future__ import annotations

import os
from pathlib import Path

DEFAULT_ENV = Path(os.environ.get("SEARCH_SKILLS_HOME", Path.home() / ".config/search-skills")) / ".env"


def load_env_file(path: str | Path) -> None:
    p = Path(path).expanduser()
    if not p.exists():
        return
    for line in p.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"\''))


def credentials() -> tuple[int, str]:
    for pre in ("TG_API", "TELEGRAM_API"):
        if os.environ.get(f"{pre}_ID") and os.environ.get(f"{pre}_HASH"):
            return int(os.environ[f"{pre}_ID"]), os.environ[f"{pre}_HASH"]
    load_env_file(DEFAULT_ENV)
    for pre in ("TG_API", "TELEGRAM_API"):
        if os.environ.get(f"{pre}_ID") and os.environ.get(f"{pre}_HASH"):
            return int(os.environ[f"{pre}_ID"]), os.environ[f"{pre}_HASH"]
    raise RuntimeError("Telegram API credentials not found: set TG_API_ID/TG_API_HASH or env_file in the config")


async def client(session: str):
    from telethon import TelegramClient
    api_id, api_hash = credentials()
    c = TelegramClient(str(Path(session).expanduser()), api_id, api_hash)
    await c.connect()
    if not await c.is_user_authorized():
        await c.disconnect()
        raise RuntimeError(f"Telegram session {session} is not authorized")
    return c
