#!/usr/bin/env bash
# Сторож простоя браузера в контейнере. Один экземпляр на всех.
#
#   container-browser.sh watch     поднять сторожа, если его ещё нет (выходит сразу)
#   container-browser.sh status    что с браузером и сколько он простаивает
#   container-browser.sh stop      погасить немедленно
#
# Зачем: headless Chromium в контейнере держит 300-400 МБ. Скилл поднимает его
# по требованию, а этот сторож гасит после SHOPEE_CONTAINER_IDLE_MIN минут
# без обращений — чтобы на ноутбуке не копилась память между задачами.
set -uo pipefail

NAME="${SHOPEE_CONTAINER:-market-browser}"
PORT="${SHOPEE_CDP_PORT:-9360}"
IDLE_MIN="${SHOPEE_CONTAINER_IDLE_MIN:-10}"
STATE_DIR="$HOME/.cache/search-skills"
STATE="$STATE_DIR/container-browser.json"
PIDFILE="$STATE_DIR/container-browser.watch.pid"

cdp_alive() { curl -s -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1; }

idle_seconds() {
  [ -f "$STATE" ] || { echo 999999; return; }
  python3 - "$STATE" <<'PY' 2>/dev/null || echo 999999
import json,sys,time
try: print(int(time.time() - json.load(open(sys.argv[1])).get("last",0)/1000))
except Exception: print(999999)
PY
}

case "${1:-status}" in
  watch)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then exit 0; fi
    mkdir -p "$STATE_DIR"
    setsid nohup bash "$0" loop >>"$STATE_DIR/container-browser.log" 2>&1 &
    echo $! > "$PIDFILE"
    ;;
  loop)
    trap 'rm -f "$PIDFILE"' EXIT
    while sleep 60; do
      cdp_alive || { [ "$(idle_seconds)" -gt 300 ] && { rm -f "$PIDFILE"; exit 0; }; continue; }
      if [ "$(idle_seconds)" -ge $((IDLE_MIN * 60)) ]; then
        echo "$(date '+%F %T') простой ${IDLE_MIN}м — гашу браузер в $NAME"
        docker exec "$NAME" /usr/local/bin/entrypoint.sh stop >/dev/null 2>&1
      fi
    done
    ;;
  stop)
    docker exec "$NAME" /usr/local/bin/entrypoint.sh stop >/dev/null 2>&1
    echo "браузер погашен"
    ;;
  status)
    if cdp_alive; then echo "CDP $PORT: жив, простой $(( $(idle_seconds) / 60 ))м"; else echo "CDP $PORT: погашен"; fi
    docker exec "$NAME" sh -c 'echo "процессов chromium: $(pgrep -c chromium 2>/dev/null || echo 0)"' 2>/dev/null || echo "контейнер $NAME недоступен"
    ;;
  *) echo "usage: $0 {watch|status|stop}" >&2; exit 2;;
esac
