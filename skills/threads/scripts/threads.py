#!/usr/bin/env python3
"""Threads API: поиск по ключевым словам, чтение и публикация.

Официальный Graph API Meta (graph.threads.net). Бесплатный, бизнес-аккаунт не нужен —
личный работает через режим Threads Tester. Лимиты: 250 публикаций и 1000 ответов
за скользящие 24 часа, 500 символов на пост.

Credentials are read from ~/.config/pi-skills/threads/env (override: THREADS_ENV).

  threads.py search "vibe coding" --limit 20
  threads.py search "агенты" --type RECENT
  threads.py me
  threads.py post "текст поста"
  threads.py post "первый" --reply-to <id>     # продолжение треда
  threads.py posts --limit 10                   # свои последние посты
  threads.py limit                              # сколько публикаций осталось
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import sys
import time
import urllib.parse
import urllib.request

API = "https://graph.threads.net/v1.0"
ENV_FILE = pathlib.Path(os.environ.get(
    "THREADS_ENV", pathlib.Path.home() / ".config" / "pi-skills" / "threads" / "env"
)).expanduser()
# Между созданием контейнера и публикацией нужна пауза: сервер обрабатывает
# контейнер асинхронно, немедленный publish отдаёт ошибку.
PUBLISH_DELAY = 30


def creds() -> dict[str, str]:
    if not ENV_FILE.exists():
        raise SystemExit(
            f"нет {ENV_FILE}\n"
            "Заполни по образцу из SKILL.md → «Настройка»:\n"
            "  THREADS_USER_ID=...\n  THREADS_ACCESS_TOKEN=TH...\n"
            "  THREADS_APP_SECRET=...   # нужен только для обновления токена"
        )
    data: dict[str, str] = {}
    for line in ENV_FILE.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            data[k.strip()] = v.strip().strip('"').strip("'")
    for key in ("THREADS_USER_ID", "THREADS_ACCESS_TOKEN"):
        if not data.get(key):
            raise SystemExit(f"в {ENV_FILE} нет {key}")
    return data


def call(path: str, params: dict, method: str = "GET") -> dict:
    c = creds()
    params = {**params, "access_token": c["THREADS_ACCESS_TOKEN"]}
    url = f"{API}/{path.lstrip('/')}"
    body = urllib.parse.urlencode(params).encode()
    if method == "GET":
        url = f"{url}?{urllib.parse.urlencode(params)}"
        body = None
    req = urllib.request.Request(url, data=body, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read().decode()[:400]
        raise SystemExit(f"Threads API {e.code}: {detail}")


# ────────────────────────────────────────────────────────────── чтение

def cmd_me(_args) -> None:
    me = call("me", {"fields": "id,username,name,threads_profile_picture_url,threads_biography"})
    print(json.dumps(me, ensure_ascii=False, indent=2))


def cmd_search(args) -> None:
    """Поиск по ключевому слову. Требует права threads_keyword_search."""
    res = call(
        "keyword_search",
        {
            "q": args.query,
            "search_type": args.type,
            "fields": "id,text,username,permalink,timestamp,has_replies",
            "limit": args.limit,
        },
    )
    items = res.get("data", [])
    if args.raw:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return
    print(f"найдено: {len(items)}")
    for it in items:
        text = (it.get("text") or "").replace("\n", " ")[:150]
        print(f"\n@{it.get('username','?')}  {it.get('timestamp','')[:16]}")
        print(f"  {text}")
        print(f"  {it.get('permalink','')}")


def cmd_posts(args) -> None:
    c = creds()
    res = call(
        f"{c['THREADS_USER_ID']}/threads",
        {"fields": "id,text,permalink,timestamp,media_type", "limit": args.limit},
    )
    for it in res.get("data", []):
        text = (it.get("text") or "").replace("\n", " ")[:110]
        print(f"{it.get('timestamp','')[:16]}  {text}")
        print(f"  {it.get('permalink','')}")


def cmd_limit(_args) -> None:
    c = creds()
    res = call(
        f"{c['THREADS_USER_ID']}/threads_publishing_limit",
        {"fields": "quota_usage,config,reply_quota_usage,reply_config"},
    )
    d = (res.get("data") or [{}])[0]
    quota = d.get("config", {}).get("quota_total", "?")
    print(f"постов за 24ч: {d.get('quota_usage', '?')} из {quota}")
    print(f"ответов за 24ч: {d.get('reply_quota_usage', '?')} из {d.get('reply_config', {}).get('quota_total', '?')}")


# ────────────────────────────────────────────────────────────── публикация

def cmd_post(args) -> None:
    c = creds()
    text = args.text
    if len(text) > 500:
        raise SystemExit(f"текст {len(text)} символов, лимит Threads — 500")

    params: dict[str, str] = {"media_type": "TEXT", "text": text}
    if args.image:
        params = {"media_type": "IMAGE", "image_url": args.image, "text": text}
    if args.reply_to:
        params["reply_to_id"] = args.reply_to
    if args.link:
        params["link_attachment"] = args.link

    if args.dry_run:
        print("DRY-RUN, уйдёт вот это:")
        print("─" * 60)
        print(text)
        print("─" * 60)
        print(f"{len(text)}/500 символов" + (f" | ответ на {args.reply_to}" if args.reply_to else ""))
        return

    container = call(f"{c['THREADS_USER_ID']}/threads", params, method="POST")
    cid = container.get("id")
    if not cid:
        raise SystemExit(f"контейнер не создан: {container}")
    print(f"контейнер {cid}, жду {PUBLISH_DELAY}с перед публикацией", file=sys.stderr)
    time.sleep(PUBLISH_DELAY)

    res = call(f"{c['THREADS_USER_ID']}/threads_publish", {"creation_id": cid}, method="POST")
    pid = res.get("id")
    info = call(pid, {"fields": "permalink"}) if pid else {}
    print(json.dumps({"id": pid, "permalink": info.get("permalink", "")}, ensure_ascii=False))


def cmd_refresh(_args) -> None:
    """Продлевает долгоживущий токен ещё на 60 дней."""
    c = creds()
    url = (
        "https://graph.threads.net/refresh_access_token"
        f"?grant_type=th_refresh_token&access_token={c['THREADS_ACCESS_TOKEN']}"
    )
    with urllib.request.urlopen(url, timeout=60) as r:
        res = json.loads(r.read())
    token = res.get("access_token")
    if not token:
        raise SystemExit(f"не обновилось: {res}")
    body = ENV_FILE.read_text()
    payload = (
        "\n".join(
            f"THREADS_ACCESS_TOKEN={token}" if l.startswith("THREADS_ACCESS_TOKEN=") else l
            for l in body.splitlines()
        )
        + "\n"
    )
    if not payload.strip():
        raise SystemExit("refusing to overwrite Threads env with an empty payload")
    tmp = ENV_FILE.with_suffix(ENV_FILE.suffix + ".tmp")
    tmp.write_text(payload)
    tmp.chmod(0o600)
    tmp.replace(ENV_FILE)
    days = int(res.get("expires_in", 0)) // 86400
    print(f"токен обновлён, годен ещё {days} дней")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("search", help="поиск по ключевому слову")
    s.add_argument("query")
    s.add_argument("--type", default="TOP", choices=["TOP", "RECENT"])
    s.add_argument("--limit", type=int, default=20)
    s.add_argument("--raw", action="store_true")
    s.set_defaults(func=cmd_search)

    s = sub.add_parser("me", help="свой профиль и user_id")
    s.set_defaults(func=cmd_me)

    s = sub.add_parser("posts", help="свои последние посты")
    s.add_argument("--limit", type=int, default=10)
    s.set_defaults(func=cmd_posts)

    s = sub.add_parser("limit", help="остаток суточной квоты")
    s.set_defaults(func=cmd_limit)

    s = sub.add_parser("post", help="опубликовать")
    s.add_argument("text")
    s.add_argument("--image", help="публичный URL картинки")
    s.add_argument("--link", help="ссылка для превью")
    s.add_argument("--reply-to", help="id поста — продолжение треда")
    s.add_argument("--dry-run", action="store_true")
    s.set_defaults(func=cmd_post)

    s = sub.add_parser("refresh", help="продлить токен на 60 дней")
    s.set_defaults(func=cmd_refresh)

    args = ap.parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
