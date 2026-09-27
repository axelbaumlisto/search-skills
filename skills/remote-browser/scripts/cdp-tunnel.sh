#!/usr/bin/env bash
# SSH-туннель до CDP удалённого браузера. Идемпотентен: уже поднятый не трогает.
#
#   cdp-tunnel.sh 9445 9444 my-host  # локальный порт, удалённый порт, ssh-хост
#   cdp-tunnel.sh 9445 9444 my-host --status
#
# Один источник правды для всех скиллов, которые ходят в удалённые браузеры:
# browser-scout (обычный Chrome, 9222) и zalo (cloak-браузер, 9444).
set -uo pipefail

LOCAL="${1:?нужен локальный порт}"
REMOTE="${2:?нужен удалённый порт}"
HOST="${3:?нужен ssh-хост}"
MODE="${4:-up}"

SPEC="${LOCAL}:127.0.0.1:${REMOTE}"

alive() { pgrep -f "ssh .*${SPEC}" >/dev/null 2>&1; }

case "$MODE" in
  --status)
    alive && echo "туннель ${SPEC} → ${HOST}: поднят" || echo "туннель ${SPEC}: нет"
    alive
    ;;
  --down)
    pkill -f "ssh .*${SPEC}" && echo "туннель ${SPEC} снят" || echo "нечего снимать"
    ;;
  *)
    if alive; then
      echo "туннель ${SPEC} уже поднят"
      exit 0
    fi
    ssh -f -N -L "$SPEC" "$HOST" || { echo "ssh не поднялся: $HOST" >&2; exit 1; }
    sleep 2
    # проверяем, что на той стороне действительно CDP, а не тишина
    if curl -s --max-time 5 "http://127.0.0.1:${LOCAL}/json/version" | grep -q Browser; then
      echo "туннель ${SPEC} → ${HOST} поднят"
    else
      echo "туннель поднят, но CDP на ${REMOTE} не отвечает — браузер запущен?" >&2
      exit 2
    fi
    ;;
esac
