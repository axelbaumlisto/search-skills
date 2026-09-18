---
name: browser-scout
description: Read pages that plain HTTP fetching cannot — Cloudflare/anti-bot walls ("Just a moment", "Verify you are human"), login-gated pages, JS-only React/Next shells, Vietnamese classifieds with click-to-reveal phones (chotot, batdongsan, alonhadat, nhatot, mogi, homedy), Facebook pages, and any site returning 403 to scripts. Drives a real logged-in Chrome and returns readable text, raw HTML or a screenshot. Use when a fetch returned a block page, empty body, or the user says "открой сайт и посмотри", "не даёт скачать", "403", "капча".
compatibility: requires ssh access to host `remote-browser` with chrome-cdp.service (CDP :9222) and python playwright installed there
---

# Browser scout

Attaches over CDP to the persistent, already-logged-in Chrome on `remote-browser`
(`chrome-cdp.service`, profile `~/.config/chrome-vnc`) via Playwright, opens the
page in a fresh tab, waits for the JS to settle, dumps content, closes the tab.

## Usage

```bash
S=~/.pi/agent/skills/browser-scout/scripts

$S/browse.sh https://lining.com.vn/collections/giay-thoi-trang-nam
$S/browse.sh https://example.com/page --chars 12000
$S/browse.sh https://example.com/page --html            # raw HTML for parsing
$S/browse.sh https://example.com/page --shot /tmp/p.png # PNG stays on remote-browser
$S/browse.sh https://slow.site --settle 15000 --wait 240
```

`# url=` and `# title=` go to stderr, so the page body on stdout stays clean
for piping. The final URL reveals redirects to login/challenge pages.

## Escalation order (cheapest first)

1. Built-in `fetch_content` / `web_search` — try these before touching the browser.
2. `scrapingbee-fetch` on the naked side — currently **has no API keys in the
   pool**, so it fails fast; skip until a key is added.
3. This skill — real browser with cookies, solves most Cloudflare interstitials
   just by being a real browser.
4. `turnstile-solve` (a Turnstile helper on the remote host) — when
   a Turnstile widget still blocks a form; capsolver keys are live, the 2captcha
   key is dead.

## Interactive work beyond a dump

For clicking, typing, scrolling and revealing phone numbers, use the naked
playbooks instead of this thin wrapper — they carry per-site recipes:

- the anti-bot playbook that ships with the remote browser host — anti-bot,
  click-to-reveal, per-site selectors for VN real-estate aggregators
- the Playwright control notes on that host — calibrating
  selectors for scraping briefs

## Shared-browser etiquette

One Chrome instance serves Facebook search, scraping briefs and the VNC
session. Therefore:

- never kill the browser to "fix" a hang — restart the service only when
  `fb-search.sh --health` shows it inactive;
- the wrapper always closes its tab, even on error — do not open tabs manually
  in loops;
- if a page needs a login, the operator signs in once at
  `https://YOUR-HOST/vnc`; the profile persists.

Related: `marketplace-search` (Facebook Marketplace listings),
`telegram-search` (classifieds inside Telegram), `google-places` (real-world
shop data).

## rbrowser.js — генерик-обёртка над браузером remote-browser

`browse.sh` читает страницу и уходит. Когда нужна последовательность действий
(клик, ввод, прокрутка, перехват GraphQL) — `scripts/rbrowser.js`: список
действий JSON-ом за один запуск, ожидание по событиям, а не по таймеру.

```bash
export NODE_PATH="$REMOTE_NODE_MODULES"   # где на хосте лежит node_modules
node scripts/rbrowser.js '[
  {"do":"goto","url":"https://example.com","wait":"h1"},
  {"do":"list","sel":"a","fields":["text","href"],"as":"links"}
]'
node scripts/rbrowser.js --tabs        # состояние браузера
node scripts/rbrowser.js --cleanup     # убрать свой мусор
```

Действия: `goto`, `wait`, `click` (в том числе по видимому тексту), `type`
(нативный сеттер для React-полей), `scroll`, `eval`, `text`, `html`, `attr`,
`list`, `gql`+`gqlDump`, `shot`, `cookies`. `soft:true` — не прерывать цепочку.

Состояние под контролем: своя вкладка переиспользуется (метка через
`addInitScript` живёт между переходами) и паркуется на `about:blank` после
работы; больше 15 страниц — свой мусор подчищается сам. Домены с живыми
сессиями владельца (`shopee.vn`, `shopee.co.th`, `accounts.google.com`,
`chotot.com`, `muaban.net`, `mail.google.com`) не закрываются никогда.

Туннель — `scripts/tunnel.sh` (tmux-сессия `remote-browser-cdp`, порт 9224, цикл
переподключения). 9223 занят `pymobiledevice3 webinspector` с работы по
айпаду, поэтому порт другой.
