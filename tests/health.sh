#!/usr/bin/env bash
# Safe health check: no browser windows/tabs, no writes, no cart mutations, no messages.
# Usage: ./tests/health.sh [--live]
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LIVE=0; [ "${1:-}" = "--live" ] && LIVE=1
fail=0; warn=0
ok()   { printf 'OK    %-18s %s\n' "$1" "$2"; }
warn() { printf 'WARN  %-18s %s\n' "$1" "$2"; warn=$((warn+1)); }
bad()  { printf 'FAIL  %-18s %s\n' "$1" "$2"; fail=$((fail+1)); }

if "$ROOT/tests/run.sh" >/tmp/search-skills-offline-health.log 2>&1; then
  ok offline "108 tests + syntax + secret scan"
else
  bad offline "see /tmp/search-skills-offline-health.log"
fi

for cmd in node python3 curl ssh osascript; do
  command -v "$cmd" >/dev/null 2>&1 && ok "dep:$cmd" "$(command -v "$cmd")" || bad "dep:$cmd" "missing"
done

APP="/Applications/ChromeBridge.app"
[ -d "$APP" ] || APP="$HOME/Applications/ChromeBridge.app"
[ -d "$APP" ] && ok chromebridge "installed; bridge window is created only by an actual Shopee/Lazada command" \
  || bad chromebridge "app not installed"

[ -f "$ROOT/skills/shopee/scripts/profile.dir" ] \
  && ok bridge-profile "$(tr -d '\n' < "$ROOT/skills/shopee/scripts/profile.dir")" \
  || warn bridge-profile "defaults to Chrome Default"

# Runtime discovery is exactly the same as tg-search.sh, but never logs in or searches.
TG=""
for cand in "$HOME"/work/*/* "$HOME/.config/telegram-search"; do
  if [ -x "$cand/.venv/bin/python" ] && [ -f "$cand/skills/telegram-reader/scripts/telegram_reader.py" ]; then TG="$cand"; break; fi
done
[ -n "$TG" ] && ok telegram-runtime "reader + venv found" || warn telegram-runtime "set TG_HOME"

if [ "$LIVE" = 1 ]; then
  # Read-only and bounded. Marketplace/browser/Zalo are omitted deliberately: they drive a browser.
  if timeout 90 bash "$ROOT/skills/telegram-search/scripts/tg-search.sh" --dialogs-list --limit 1 >/tmp/tg-health.out 2>/tmp/tg-health.err; then
    ok telegram-live "authorized"
  else
    bad telegram-live "$(head -c 140 /tmp/tg-health.err)"
  fi
  if timeout 90 bash "$ROOT/skills/shopee/scripts/shopee.sh" --check >/tmp/shopee-health.out 2>/tmp/shopee-health.err; then
    ok shopee-live "authorized"
  else
    bad shopee-live "$(head -c 140 /tmp/shopee-health.err)"
  fi
else
  warn live "skipped; pass --live for read-only Telegram/Shopee checks"
fi

printf '\nhealth: %d fail, %d warning\n' "$fail" "$warn"
[ "$fail" = 0 ]
