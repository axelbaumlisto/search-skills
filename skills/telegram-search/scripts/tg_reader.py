#!/usr/bin/env python3
"""Live Telegram search over the accounts you are already logged into.

No offline index: every call hits Telegram through Telethon, so results are
always current. Three things it does well:

    list_dialogs     what chats/channels this account can see
    search_global    server-side full-text search across N most recent dialogs
    search_chat      search inside one chat (optionally only your own messages)
    batch            several queries in one session (never run two processes)

Configuration comes from the environment or a .env file (see .env.example):

    TG_API_ID / TG_API_HASH        from https://my.telegram.org
    TG_SESSION                     session name, default "default"
    TG_SESSION_DIR                 where .session files live
                                   default ~/.config/search-skills/tg

Accounts: pass --account <name>; it maps to TG_API_ID_<NAME>/TG_API_HASH_<NAME>
and session file <name>.session when those exist, otherwise the shared values
are reused. Keeping a separate "research" account away from your personal one is
the entire reason this switch exists.

Never run the same session file from two machines at once — Telegram answers
AUTH_KEY_DUPLICATED and logs the account out everywhere.
"""
from __future__ import annotations

import argparse
import asyncio
import fcntl
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from telethon import TelegramClient
    from telethon.tl.types import Channel, Chat, User
except ImportError:  # pragma: no cover
    sys.exit("telethon is missing: pip install -r requirements.txt")

HOME = Path(os.environ.get("SEARCH_SKILLS_HOME") or (Path.home() / ".config" / "search-skills"))
SESSION_DIR = Path(os.environ.get("TG_SESSION_DIR") or (HOME / "tg"))


def load_dotenv(path: Path) -> None:
    """Minimal .env loader: real environment always wins."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))


def credentials(account: str) -> tuple[int, str, str]:
    suffix = f"_{account.upper()}"
    api_id = os.environ.get(f"TG_API_ID{suffix}") or os.environ.get("TG_API_ID")
    api_hash = os.environ.get(f"TG_API_HASH{suffix}") or os.environ.get("TG_API_HASH")
    if not api_id or not api_hash:
        sys.exit("set TG_API_ID and TG_API_HASH (get them at https://my.telegram.org)")
    session = os.environ.get(f"TG_SESSION{suffix}") or (
        account if account != "default" else os.environ.get("TG_SESSION", "default"))
    return int(api_id), api_hash, session


def entity_dict(e) -> dict:
    if e is None:
        return {}
    if isinstance(e, User):
        kind = "user"
        name = " ".join(x for x in (e.first_name, e.last_name) if x) or None
    elif isinstance(e, Chat):
        kind, name = "group", e.title
    elif isinstance(e, Channel):
        kind = "supergroup" if e.megagroup else "channel"
        name = e.title
    else:
        kind, name = type(e).__name__.lower(), getattr(e, "title", None)
    return {"id": getattr(e, "id", None), "type": kind, "name": name,
            "username": getattr(e, "username", None)}


def message_link(chat, msg_id: int) -> str | None:
    username = getattr(chat, "username", None)
    if username:
        return f"https://t.me/{username}/{msg_id}"
    cid = getattr(chat, "id", None)
    return f"https://t.me/c/{cid}/{msg_id}" if cid else None


def pack(msg, chat) -> dict:
    sender = getattr(msg, "sender", None)
    username = getattr(sender, "username", None)
    return {
        "id": msg.id,
        "date": msg.date.isoformat() if msg.date else None,
        "text": msg.text or "",
        "outgoing": bool(msg.out),
        "chat": entity_dict(chat),
        "author_contact": f"@{username}" if username else None,
        "message_link": message_link(chat, msg.id),
    }


def parse_dt(value: str | None):
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc) if value else None


class Reader:
    def __init__(self, client: TelegramClient):
        self.client = client

    async def list_dialogs(self, limit: int) -> dict:
        out = []
        async for d in self.client.iter_dialogs(limit=limit):
            out.append(entity_dict(d.entity))
        return {"success": True, "count": len(out), "dialogs": out}

    async def search_global(self, query: str, limit: int, dialogs_limit: int,
                            channel_filter: str | None, date_from: str | None,
                            date_to: str | None) -> dict:
        """Telegram has no cross-chat search API, so iterate dialogs and search each.

        Scanning fewer than ~200 dialogs silently returns zero matches for queries
        that do have hits: the interesting chats simply sit below the cut.
        """
        since, until = parse_dt(date_from), parse_dt(date_to)
        results, scanned = [], 0
        async for dialog in self.client.iter_dialogs(limit=dialogs_limit):
            if len(results) >= limit:
                break
            entity = dialog.entity
            if channel_filter:
                haystack = f"{getattr(entity, 'title', '')} {getattr(entity, 'username', '')}".lower()
                if channel_filter.lower() not in haystack:
                    continue
            scanned += 1
            try:
                async for msg in self.client.iter_messages(entity, search=query, limit=limit):
                    if since and msg.date < since:
                        continue
                    if until and msg.date > until:
                        continue
                    results.append(pack(msg, entity))
                    if len(results) >= limit:
                        break
            except Exception:  # noqa: BLE001 - a single unreadable chat must not kill the scan
                continue
        results.sort(key=lambda r: r["date"] or "", reverse=True)
        return {"success": True, "query": query, "count": len(results),
                "dialogs_scanned": scanned, "results": results}

    async def search_chat(self, chat: str, query: str | None, limit: int,
                          sender: str | None, only_mine: bool,
                          date_from: str | None, date_to: str | None) -> dict:
        entity = await self.client.get_entity(chat)
        since, until = parse_dt(date_from), parse_dt(date_to)
        from_user = "me" if only_mine else sender
        results = []
        async for msg in self.client.iter_messages(
                entity, search=query, limit=limit,
                **({"from_user": from_user} if from_user else {})):
            if since and msg.date < since:
                break
            if until and msg.date > until:
                continue
            results.append(pack(msg, entity))
        return {"success": True, "query": query, "count": len(results),
                "chat": entity_dict(entity), "results": results}

    async def context(self, chat: str, around: int, before: int, after: int) -> dict:
        entity = await self.client.get_entity(chat)
        ids = list(range(around - before, around + after + 1))
        msgs = await self.client.get_messages(entity, ids=ids)
        return {"success": True, "chat": entity_dict(entity),
                "results": [pack(m, entity) for m in msgs if m]}


async def run(args) -> dict:
    api_id, api_hash, session = credentials(args.account)
    SESSION_DIR.mkdir(parents=True, exist_ok=True)
    path = SESSION_DIR / session

    # A killed-but-unreaped sibling keeps the SQLite session busy; fail loudly instead
    # of hanging forever on a lock Telethon never reports.
    lock = open(f"{path}.lock", "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return {"success": False, "error": f"session {session} is busy (another run holds {path}.lock)"}

    if not path.with_suffix(".session").exists():
        return {"success": False,
                "error": f"no session '{session}' in {SESSION_DIR} — run: tg-search.sh --login"
                         f"{'' if args.account == 'default' else f' --account {args.account}'}"}

    client = TelegramClient(str(path), api_id, api_hash)
    # A dead auth key does not raise on connect; it surfaces as "not authorized" below.
    await client.connect()
    try:
        if not await client.is_user_authorized():
            return {"success": False, "error": "session is not authorized — run: tg-search.sh --login"}
        r = Reader(client)
        if args.action == "list_dialogs":
            return await r.list_dialogs(args.limit)
        if args.action == "search_global":
            return await r.search_global(args.query, args.limit, args.dialogs_limit,
                                         args.channel_filter, args.date_from, args.date_to)
        if args.action == "search_chat":
            return await r.search_chat(args.chat, args.query, args.limit, args.sender,
                                       args.mine, args.date_from, args.date_to)
        if args.action == "context":
            return await r.context(args.chat, args.around, args.before, args.after)
        if args.action == "batch":
            queries = json.loads(args.batch_json)
            out = []
            for q in queries:
                out.append({"query": q.get("query"), "result": await r.search_global(
                    q.get("query"), int(q.get("limit", args.limit)),
                    int(q.get("dialogs", args.dialogs_limit)),
                    q.get("channel"), q.get("since"), q.get("until"))})
            return {"success": True, "batch": out}
        return {"success": False, "error": f"unknown action {args.action}"}
    finally:
        await client.disconnect()
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()


def main() -> None:
    load_dotenv(Path(os.environ.get("SEARCH_SKILLS_ENV") or (HOME / ".env")))
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("action", choices=["list_dialogs", "search_global", "search_chat",
                                      "context", "batch"])
    p.add_argument("--account", default="default", help="account label, e.g. research")
    p.add_argument("--query")
    p.add_argument("--chat", help="@username, t.me link or numeric id")
    p.add_argument("--sender", help="filter by sender (@username or id)")
    p.add_argument("--mine", action="store_true", help="only your own messages in that chat")
    p.add_argument("--limit", type=int, default=20)
    p.add_argument("--dialogs-limit", type=int, default=200,
                   help="how many dialogs to scan; below ~200 matches go missing")
    p.add_argument("--channel-filter", help="only chats whose name/username contains this")
    p.add_argument("--date-from")
    p.add_argument("--date-to")
    p.add_argument("--around", type=int, help="message id for `context`")
    p.add_argument("--before", type=int, default=10)
    p.add_argument("--after", type=int, default=10)
    p.add_argument("--batch-json", help='[{"query":"a","limit":20}, {"query":"b"}]')
    args = p.parse_args()
    print(json.dumps(asyncio.run(run(args)), ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
