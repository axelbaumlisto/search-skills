#!/usr/bin/env python3
"""Gmail: чтение писем и черновики. Реализации отправки нет.

Запрошены gmail.modify и gmail.settings.basic. Google определяет modify широко,
поэтому граница безопасности — отсутствие команды отправки и соответствующего API-вызова
в этом проверяемом исходнике. Отправка требует открыть черновик и нажать кнопку рукой.

OAuth-клиент и токен лежат вне репозитория в ~/.config/pi-skills/gmail/.
Пути можно переопределить GMAIL_OAUTH_CLIENT и GMAIL_TOKEN_FILE; токен — mode 600.

  gmail.py auth                       # первый вход: печатает ссылку
  gmail.py auth <code>                # обмен кода на токен
  gmail.py labels                     # ярлыки и счётчики
  gmail.py search "from:bank" -n 10   # поиск синтаксисом Gmail
  gmail.py read <id>                  # письмо целиком: заголовки и текст
  gmail.py draft --to a@b.c --subject "..." --body "..."
  gmail.py draft-reply <id> --body "..."   # черновик-ответ в том же треде
  gmail.py drafts                     # список черновиков
"""

import argparse
import base64
import json
import os
import re
import sys
from email.message import EmailMessage
from pathlib import Path

from google.auth.transport.requests import Request
from google.auth.exceptions import RefreshError
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

# Google возвращает вместе с новым правом все ранее выданные этому клиенту
# (тут — adwords), а oauthlib считает расхождение scope ошибкой и роняет обмен.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")

CONFIG_DIR = Path(os.environ.get("GMAIL_CONFIG_DIR", Path.home() / ".config" / "pi-skills" / "gmail"))
CREDS = Path(os.environ.get("GMAIL_OAUTH_CLIENT", CONFIG_DIR / "credentials.json")).expanduser()
TOKEN = Path(os.environ.get("GMAIL_TOKEN_FILE", CONFIG_DIR / "token.json")).expanduser()
# Только чтение, метки и черновики. Отправки в этом наборе нет.
SCOPES = ["https://www.googleapis.com/auth/gmail.modify",
          "https://www.googleapis.com/auth/gmail.settings.basic"]
REDIRECT = "http://localhost"


def flow() -> Flow:
    f = Flow.from_client_secrets_file(str(CREDS), scopes=SCOPES,
                                      autogenerate_code_verifier=False)
    f.redirect_uri = REDIRECT
    return f


def cmd_auth(code: str | None) -> None:
    if not code:
        # include_granted_scopes не просим: лишние права в ответе только мешают.
        url, _ = flow().authorization_url(access_type="offline", prompt="consent")
        print("Открой ссылку, разреши доступ, потом скопируй code из адресной строки:\n")
        print(url)
        print("\nБраузер уйдёт на http://localhost/?code=... — страница не загрузится, это норма.")
        return
    f = flow()
    f.fetch_token(code=code)
    TOKEN.parent.mkdir(parents=True, exist_ok=True)
    tmp = TOKEN.with_suffix(TOKEN.suffix + ".tmp")
    payload = f.credentials.to_json()
    if not payload:
        raise SystemExit("OAuth вернул пустой токен")
    tmp.write_text(payload)
    tmp.chmod(0o600)
    tmp.replace(TOKEN)
    print(f"токен записан: {TOKEN} (600)")


def service():
    if not TOKEN.exists():
        sys.exit("нет токена. Сначала: gmail.py auth")
    creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
            except RefreshError as e:
                detail = str(e).lower()
                if "invalid_grant" in detail or "expired or revoked" in detail:
                    sys.exit("Gmail OAuth отозван. Нужен ручной вход: gmail.py auth")
                sys.exit(f"Gmail OAuth refresh: {str(e)[:160]}")
            TOKEN.parent.mkdir(parents=True, exist_ok=True)
            tmp = TOKEN.with_suffix(TOKEN.suffix + ".tmp")
            payload = creds.to_json()
            if not payload:
                sys.exit("Gmail OAuth refresh вернул пустой токен")
            tmp.write_text(payload)
            tmp.chmod(0o600)
            tmp.replace(TOKEN)
        else:
            sys.exit("Gmail OAuth отсутствует. Нужен ручной вход: gmail.py auth")
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def header(msg: dict, name: str) -> str:
    for h in msg.get("payload", {}).get("headers", []):
        if h["name"].lower() == name.lower():
            return h["value"]
    return ""


def body_text(payload: dict) -> str:
    """Текст письма. Идём по частям вглубь: text/plain предпочтительнее html."""
    if payload.get("body", {}).get("data"):
        raw = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", "replace")
        if payload.get("mimeType") == "text/html":
            # style и script выкидываем ЦЕЛИКОМ: если просто снять теги,
            # в текст письма попадает вся таблица стилей.
            raw = re.sub(r"(?is)<(style|script|head)[^>]*>.*?</\1>", " ", raw)
            raw = re.sub(r"(?is)<br\s*/?>|</p>|</div>|</tr>", "\n", raw)
            raw = re.sub(r"<[^>]+>", " ", raw)
            raw = re.sub(r"&nbsp;?", " ", raw)
            raw = re.sub(r"&amp;", "&", raw)
            raw = re.sub(r"[ \t]{2,}", " ", raw)
            raw = re.sub(r"\n\s*\n\s*\n+", "\n\n", raw)
        return raw
    best = ""
    for part in payload.get("parts", []) or []:
        txt = body_text(part)
        if part.get("mimeType") == "text/plain" and txt.strip():
            return txt
        if txt.strip() and not best:
            best = txt
    return best


def cmd_labels(svc) -> None:
    for l in svc.users().labels().list(userId="me").execute().get("labels", []):
        if l["type"] != "user" and l["id"] not in ("INBOX", "UNREAD", "SENT", "DRAFT", "SPAM"):
            continue
        d = svc.users().labels().get(userId="me", id=l["id"]).execute()
        print(f"  {l['name'][:28]:<28} писем {d.get('messagesTotal', 0):>6}"
              f"  непрочитанных {d.get('messagesUnread', 0):>5}")


def cmd_archive(svc, query: str, yes: bool, label: str | None, trash: bool = False) -> None:
    """Убрать письма из «Входящих». Это не удаление: снимается ярлык INBOX,
    письма остаются в поиске и во  «Всей почте». Без --yes только считает.

    batchModify берёт не больше 1000 id за раз, поэтому идём пачками.
    """
    ids, tok = [], None
    while True:
        r = svc.users().messages().list(userId="me", q=query, maxResults=500,
                                        pageToken=tok).execute()
        ids += [m["id"] for m in r.get("messages", [])]
        tok = r.get("nextPageToken")
        if not tok:
            break
    print(f"подходит писем: {len(ids)}")
    if not ids:
        return
    if not yes:
        print("сухой прогон — ничего не тронуто; для дела добавь --yes")
        return

    label_id = None
    if label:
        existing = {l["name"]: l["id"]
                    for l in svc.users().labels().list(userId="me").execute()["labels"]}
        label_id = existing.get(label) or svc.users().labels().create(
            userId="me", body={"name": label, "labelListVisibility": "labelShow",
                               "messageListVisibility": "show"}).execute()["id"]

    # Корзина — тоже ярлык: выставляем TRASH через batchModify, чтобы уложиться
    # в права gmail.modify. Безвозвратного удаления скилл не умеет сознательно:
    # из корзины письмо можно вернуть 30 дней, из небытия — никогда.
    body = {"removeLabelIds": ["INBOX"]}
    if trash:
        body["addLabelIds"] = ["TRASH"]
    elif label_id:
        body["addLabelIds"] = [label_id]
    for i in range(0, len(ids), 1000):
        chunk = ids[i:i + 1000]
        svc.users().messages().batchModify(userId="me", body={**body, "ids": chunk}).execute()
        print(f"  убрано из входящих: {min(i + 1000, len(ids))} из {len(ids)}")
    print("готово; письма целы и находятся поиском")


def cmd_search(svc, query: str, n: int) -> None:
    res = svc.users().messages().list(userId="me", q=query, maxResults=n).execute()
    ids = [m["id"] for m in res.get("messages", [])]
    print(f"найдено: {res.get('resultSizeEstimate', len(ids))}, показываю {len(ids)}\n")
    for mid in ids:
        m = svc.users().messages().get(userId="me", id=mid, format="metadata",
                                       metadataHeaders=["From", "Subject", "Date"]).execute()
        unread = "•" if "UNREAD" in m.get("labelIds", []) else " "
        print(f" {unread} {header(m, 'Date')[:22]:<22} {header(m, 'From')[:30]:<30}"
              f" {header(m, 'Subject')[:44]}")
        print(f"     id {mid}")


def cmd_read(svc, mid: str) -> None:
    m = svc.users().messages().get(userId="me", id=mid, format="full").execute()
    for h in ("From", "To", "Date", "Subject"):
        print(f"{h:<9} {header(m, h)}")
    print(f"{'тред':<9} {m.get('threadId')}\n")
    print(re.sub(r"\n{3,}", "\n\n", body_text(m.get("payload", {})))[:4000])


def attach(msg: EmailMessage, paths: list[str]) -> None:
    """Вложения в черновик. Тип угадываем по расширению: Gmail сам ничего не
    определяет, а с application/octet-stream превью не строится."""
    import mimetypes
    for raw in paths:
        f = Path(raw).expanduser()
        if not f.exists():
            raise SystemExit(f"нет файла: {f}")
        ctype, _ = mimetypes.guess_type(f.name)
        maintype, _, subtype = (ctype or "application/octet-stream").partition("/")
        msg.add_attachment(f.read_bytes(), maintype=maintype, subtype=subtype, filename=f.name)


def make_draft(svc, to: str, subject: str, body: str, thread: str | None,
               in_reply_to: str | None, cc: str | None = None,
               files: list[str] | None = None) -> dict:
    msg = EmailMessage()
    msg["To"] = to
    if cc:
        msg["Cc"] = cc
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    msg.set_content(body)
    if files:
        attach(msg, files)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    payload = {"message": {"raw": raw}}
    if thread:
        payload["message"]["threadId"] = thread
    return svc.users().drafts().create(userId="me", body=payload).execute()


def cmd_draft(svc, to: str, subject: str, body: str, cc: str | None = None,
               files: list[str] | None = None) -> None:
    d = make_draft(svc, to, subject, body, None, None, cc, files)
    print(f"черновик создан: id {d['id']}")
    print("открыть: https://mail.google.com/mail/u/0/#drafts")


def cmd_draft_reply(svc, mid: str, body: str, cc: str | None = None,
                    files: list[str] | None = None) -> None:
    m = svc.users().messages().get(userId="me", id=mid, format="metadata",
                                   metadataHeaders=["From", "Subject", "Message-ID"]).execute()
    subject = header(m, "Subject")
    if not subject.lower().startswith("re:"):
        subject = "Re: " + subject
    d = make_draft(svc, header(m, "From"), subject, body,
                   m.get("threadId"), header(m, "Message-ID"), cc, files)
    print(f"черновик-ответ создан: id {d['id']}, тред {m.get('threadId')}")


def walk_parts(payload: dict):
    """Все части письма подряд, включая вложенные multipart."""
    yield payload
    for part in payload.get("parts", []) or []:
        yield from walk_parts(part)


def cmd_files(svc, mid: str, save_dir: str | None) -> None:
    """Вложения письма: показать список, а с --save скачать."""
    m = svc.users().messages().get(userId="me", id=mid, format="full").execute()
    found = 0
    for part in walk_parts(m.get("payload", {})):
        name = part.get("filename")
        if not name:
            continue
        found += 1
        size = part.get("body", {}).get("size", 0)
        att_id = part.get("body", {}).get("attachmentId")
        print(f"  {name[:56]:<56} {size / 1024:>8.0f} КБ  {part.get('mimeType', '')}")
        if save_dir and att_id:
            data = svc.users().messages().attachments().get(
                userId="me", messageId=mid, id=att_id).execute()
            out = Path(save_dir).expanduser() / name
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(base64.urlsafe_b64decode(data["data"]))
            print(f"      сохранено: {out}")
    if not found:
        print("  вложений нет")


def cmd_drafts(svc) -> None:
    res = svc.users().drafts().list(userId="me", maxResults=20).execute()
    ds = res.get("drafts", [])
    print(f"черновиков: {len(ds)}")
    for d in ds:
        m = svc.users().drafts().get(userId="me", id=d["id"], format="metadata").execute()
        msg = m.get("message", {})
        print(f"  {d['id']:<20} {header(msg, 'To')[:26]:<26} {header(msg, 'Subject')[:40]}")


def main() -> None:
    ap = argparse.ArgumentParser(description="Gmail: чтение и черновики, без отправки")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("auth"); a.add_argument("code", nargs="?")
    sub.add_parser("labels")
    s = sub.add_parser("search"); s.add_argument("query"); s.add_argument("-n", type=int, default=10)
    r = sub.add_parser("read"); r.add_argument("id")
    d = sub.add_parser("draft")
    d.add_argument("--to", required=True); d.add_argument("--subject", required=True)
    d.add_argument("--body", required=True); d.add_argument("--cc")
    d.add_argument("--attach", action="append",
                   help="файл вложением; можно несколько раз")
    dr = sub.add_parser("draft-reply"); dr.add_argument("id"); dr.add_argument("--body", required=True)
    dr.add_argument("--cc"); dr.add_argument("--attach", action="append")
    fl = sub.add_parser("files"); fl.add_argument("id")
    fl.add_argument("--save", help="каталог для скачивания")
    sub.add_parser("drafts")
    ar = sub.add_parser("archive"); ar.add_argument("query")
    ar.add_argument("--yes", action="store_true", help="без него — только подсчёт")
    ar.add_argument("--label", help="заодно повесить ярлык")
    ar.add_argument("--trash", action="store_true", help="в корзину (самоочистка через 30 дней)")
    args = ap.parse_args()

    if args.cmd == "auth":
        return cmd_auth(args.code)

    svc = service()
    try:
        if args.cmd == "labels": cmd_labels(svc)
        elif args.cmd == "search": cmd_search(svc, args.query, args.n)
        elif args.cmd == "read": cmd_read(svc, args.id)
        elif args.cmd == "draft": cmd_draft(svc, args.to, args.subject, args.body,
                                            args.cc, args.attach)
        elif args.cmd == "draft-reply": cmd_draft_reply(svc, args.id, args.body, args.cc, args.attach)
        elif args.cmd == "files": cmd_files(svc, args.id, args.save)
        elif args.cmd == "drafts": cmd_drafts(svc)
        elif args.cmd == "archive": cmd_archive(svc, args.query, args.yes, args.label, args.trash)
    except HttpError as e:
        detail = getattr(e, "reason", "") or str(e)
        if "has not been used in project" in detail or "is disabled" in detail:
            m = re.search(r"https://console\S+", detail)
            sys.exit("Gmail API в проекте выключен. Включи: "
                     + (m.group(0).rstrip(".") if m else
                        "https://console.cloud.google.com/apis/library/gmail.googleapis.com"))
        sys.exit(f"Gmail API: {detail[:200]}")


if __name__ == "__main__":
    main()
