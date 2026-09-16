---
name: telegram-search
description: Live search across joined Telegram chats and channels (classifieds, city chats, expat groups in Vietnam/Thailand) plus personal DMs. Use when the user wants to find listings, prices, contacts, rentals, second-hand goods, services or discussions inside Telegram — "поищи в телеге", "объявления в телеграме", "что пишут в чатах про X", "найди продавца", "telegram search". Also lists joined channels and downloads files/images from a chat.
compatibility: macOS/Linux with ~/work/tg_agent/naked checkout, uv venv and an authorized Telethon session.
---

# Telegram search

Live search through the Telegram API (Telethon). No offline index — every call
hits Telegram, so results are always current.

## Usage

```bash
S=~/.pi/agent/skills/telegram-search/scripts

$S/tg-search.sh "кроссовки"                        # research account, 20 hits, formatted
$S/tg-search.sh "giày 45" --limit 40 --dialogs 300 # wider scan
$S/tg-search.sh "аренда" --channel danang          # only chats whose name matches
$S/tg-search.sh "iphone" --since 2026-09-01T00:00:00
$S/tg-search.sh "квартира" --account default       # personal account instead of research
$S/tg-search.sh --dialogs-list --limit 40          # which chats/channels are joined
$S/tg-search.sh "nails" --raw                      # raw JSON for further processing
```

Several queries at once — always batch, never parallel calls (they fight over
the session lock):

```bash
$S/tg-search.sh --batch '[{"query":"кроссовки 45","limit":20},{"query":"sneakers 29cm","limit":20}]'
```

Output per hit: date, chat name, text (trimmed), `@author` and a `t.me` link.

## Accounts

| `--account` | Who | What it sees |
|-------------|-----|--------------|
| `research` (default) | `@Axelis_taurus_chats` | classifieds/city channels: Дананг, Самуи, Фукуок, Пхукет, Нячанг, IT-чаты |
| `default` | personal account | private chats, DMs, own groups |

## Rules that matter

- `--dialogs` below ~200 silently returns `count: 0` on queries that do have
  matches; 200–300 is the working range.
- Query is matched by Telegram server-side full-text search: short stems win
  ("кроссовки" > "белые кроссовки 45 размер"). Vary wording across a batch
  instead of writing one long query.
- Russian and Vietnamese both work; for VN goods try both (`кроссовки`, `giày`).
- The wrapper kills stale `telegram_reader.py` processes first — a killed-but-
  unreaped process holds an `fcntl` lock and every later call answers
  "Telegram session is busy".

## When search returns nothing but the session looks fine

Dead auth key does not raise — the process just hangs with empty stdout. Re-auth
needs the login code from the operator:

```bash
cd ~/work/tg_agent/naked
nohup .venv/bin/python skills/telegram-reader/scripts/reauth.py \
      --account research --session research_new > /tmp/tg_auth.log 2>&1 &
# ask the user for the code that arrived INSIDE Telegram, then:
echo <code> > /tmp/tg_code.txt
cat /tmp/tg_auth.log            # expect OK_AUTHORIZED
cd skills/telegram-reader/.session
mv research_session.session research_session.session.DEAD.$(date +%Y%m%d)
cp research_new.session research_session.session
```

## More actions

Beyond search the underlying script does `join_channels`, `search_channels`,
`download_files`, `download_images`, `export_messages`, `extract_links`,
`forward_messages`. Reference:
`~/work/tg_agent/naked/skills/telegram-reader/SKILL.md`,
runbook `~/work/tg_agent/naked/skills/telegram-reader/README.md`.

Never use the same session simultaneously here and on `remote-browser` —
`AUTH_KEY_DUPLICATED` logs the account out everywhere.
