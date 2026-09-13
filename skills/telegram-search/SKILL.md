---
name: telegram-search
description: Live search across joined Telegram chats and channels (classifieds, city chats, expat groups) plus private chats. Use when the user wants to find listings, prices, contacts, rentals, second-hand goods, services or past discussions inside Telegram — "поищи в телеге", "объявления в телеграме", "что пишут в чатах про X", "найди продавца", "telegram search". Also lists joined chats, finds your own messages in a chat and pulls the surrounding context.
compatibility: needs Telethon and an authorized session (TG_API_ID / TG_API_HASH from my.telegram.org)
---

# Telegram search

Live search through the Telegram API (Telethon). No offline index — every call
hits Telegram, so results are always current.

## Usage

```bash
S=<repo>/skills/telegram-search/scripts   # ./scripts relative to this SKILL.md

$S/tg-search.sh "кроссовки"                        # 20 hits, 200 dialogs scanned
$S/tg-search.sh "giày 45" --limit 40 --dialogs 300 # wider scan
$S/tg-search.sh "аренда" --channel danang          # only chats whose name matches
$S/tg-search.sh "iphone" --since 2026-09-01T00:00:00
$S/tg-search.sh "квартира" --account research      # a second, separate account
$S/tg-search.sh --dialogs-list --limit 40          # what this account can see
$S/tg-search.sh --in @somechat "стрим" --mine      # inside one chat, only my messages
$S/tg-search.sh --context @somechat 106157 --before 20 --after 20
$S/tg-search.sh "nails" --raw                      # raw JSON for further processing
$S/tg-search.sh "аренда" --until 2026-09-01T00:00:00  # upper date bound
$S/tg-search.sh --login                            # authorize a new session
```

Several queries at once — always batch, never parallel calls (they fight over
the session lock):

```bash
$S/tg-search.sh --batch '[{"query":"кроссовки 45","limit":20},
                          {"query":"sneakers 29cm","limit":40,"dialogs":300,"channel":"danang","since":"2026-08-01T00:00:00"}]'
```

Output per hit: date, chat name, text (trimmed), `@author` and a `t.me` link.

## Setup

1. Get `api_id` / `api_hash` at <https://my.telegram.org> → API development tools.
2. Put them in `~/.config/search-skills/.env`:

   ```ini
   TG_API_ID=1234567
   TG_API_HASH=0123456789abcdef0123456789abcdef
   # optional second identity, used by --account research
   TG_API_ID_RESEARCH=...
   TG_API_HASH_RESEARCH=...
   ```

3. `./skills/telegram-search/scripts/tg-search.sh --login` (add `--account research`
   for the second one). The code arrives **inside Telegram**, not by SMS, when you
   are already logged in elsewhere.

Sessions live in `~/.config/search-skills/tg/<name>.session` — treat each file
like a password: whoever holds it is logged into that account.

## Accounts

Keeping a "research" account separate from the personal one is the whole point
of `--account`: joining 200 classifieds channels from your main account ruins
its notification feed and links your identity to every group you watch.

## Rules that matter

- `--dialogs` below ~200 silently returns `count: 0` on queries that do have
  matches — the interesting chats simply sit below the cut. 200–300 is the
  working range; each extra hundred costs seconds, not minutes.
- Query is matched by Telegram server-side full-text search: short stems win
  ("кроссовки" > "белые кроссовки 45 размер"). Vary wording across a batch
  instead of writing one long query.
- Russian, Vietnamese and Thai all work; for local goods try both languages
  (`кроссовки`, `giày`).
- **A plain chat search hides your own messages if you filter by sender wrong.**
  Use `--in <chat> --mine` — it passes `from_user='me'`, which is the only way
  to get your own outgoing messages back.
- `--login` is interactive (it asks for the phone, then the code): run it in a real terminal, not
  from inside an agent.
- Two processes on one session file = `database is locked` and a wedged run.
  The wrapper kills any running `tg_reader.py` (including a healthy concurrent one) and takes an `flock`.
- **Never run the same `.session` from two machines.** Telegram answers
  `AUTH_KEY_DUPLICATED` and logs the account out everywhere.

## When search returns nothing but the session looks fine

A dead auth key does not raise — the client just reports "not authorized".
Re-run `tg-search.sh --login --account <name>`; the old session file can be
moved aside first (`mv research.session research.session.dead`).

## Rate and etiquette

Telethon paces requests, but a scan of 300 dialogs is still 300 searches. Keep
scans purposeful, batch queries, and do not build a crawler that reads every
chat on a timer — accounts get limited for exactly that.
