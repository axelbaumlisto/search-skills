#!/bin/bash
# Один живой туннель до CDP удалённого браузера, в tmux-сессии.
#
# Раньше обёртка плодила `ssh -fN` на каждый холодный старт: процессы
# копились, а после обрыва связи никто их не поднимал. Здесь одна сессия tmux
# с циклом переподключения — видно глазами (`tmux attach -t <сессия>`),
# переживает обрывы и не размножается.
#
#   ./tunnel.sh          поднять, если не поднят (идемпотентно)
#   ./tunnel.sh status   что с ним
#   ./tunnel.sh stop     погасить
#   ./tunnel.sh log      последние строки
set -u
# всё личное — снаружи, из SKILLS_CONFIG; без него generic-значения
CFG="${SKILLS_CONFIG:-}"
val() {   # val ключ значение-по-умолчанию
  local f="${CFG/#\~/$HOME}"
  if [ -n "$f" ] && [ -f "$f" ]; then
    python3 -c "import json,sys;d=json.load(open(sys.argv[1])).get('remoteBrowser',{});print(d.get(sys.argv[2],sys.argv[3]))" "$f" "$1" "$2" 2>/dev/null || echo "$2"
  else
    echo "$2"
  fi
}
SESSION=$(val tmuxCdpSession cdp-tunnel)
# 9223 занят pymobiledevice3 webinspector (работа по айпаду) — берём свой
LPORT=$(val cdpLocalPort 9224)
RPORT=$(val cdpRemotePort 9222)
HOST=$(val sshHost remote-browser)

# Второй проброс — noVNC: публичный адрес обычно за авторизацией,
# через туннель экран сервера открывается без неё.
VNC_SESSION=$(val tmuxVncSession vnc-tunnel)
VNC_LPORT=$(val vncLocalPort 6080)
VNC_RPORT=$(val vncRemotePort 6081)

alive() { curl -s --max-time 3 "http://127.0.0.1:$LPORT/json/version" >/dev/null 2>&1; }

case "${1:-up}" in
  status)
    tmux has-session -t "$SESSION" 2>/dev/null && echo "сессия tmux: есть" || echo "сессия tmux: нет"
    if alive; then
      curl -s --max-time 3 "http://127.0.0.1:$LPORT/json/version" \
        | python3 -c "import json,sys;print('CDP отвечает:', json.load(sys.stdin)['Browser'])"
    else
      echo "CDP: молчит"
    fi
    pgrep -fl "ssh -N -L $LPORT" | head -3
    ;;
  stop)
    tmux kill-session -t "$SESSION" 2>/dev/null && echo "сессия убита" || echo "сессии не было"
    pkill -f "ssh -N -L $LPORT:127.0.0.1:$RPORT" 2>/dev/null && echo "ssh добит" || true
    ;;
  log)
    tmux capture-pane -p -t "$SESSION" 2>/dev/null | grep -v '^[[:space:]]*$' | tail -12 \
      || echo "сессии нет"
    ;;
  vnc)
    if lsof -nP -iTCP:$VNC_LPORT -sTCP:LISTEN >/dev/null 2>&1; then
      echo "noVNC уже проброшен: http://127.0.0.1:$VNC_LPORT/vnc.html"
      exit 0
    fi
    tmux kill-session -t "$VNC_SESSION" 2>/dev/null || true
    tmux new-session -d -s "$VNC_SESSION" \
      "while true; do \
         ssh -N -L $VNC_LPORT:127.0.0.1:$VNC_RPORT \
             -o ControlMaster=no -o ControlPath=none \
             -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
             -o ExitOnForwardFailure=yes $HOST; \
         sleep 3; \
       done"
    for _ in $(seq 1 20); do
      sleep 0.5
      curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$VNC_LPORT/vnc.html" \
        && { echo "noVNC: http://127.0.0.1:$VNC_LPORT/vnc.html"; exit 0; }
    done
    echo "noVNC не поднялся"
    exit 1
    ;;
  up|*)
    # порт мог занять кто-то чужой — молча лезть поверх нельзя
    BUSY=$(lsof -nP -iTCP:$LPORT -sTCP:LISTEN 2>/dev/null | awk 'NR>1 && $1!="ssh"{print $1; exit}')
    if [ -n "$BUSY" ]; then
      echo "порт $LPORT занят процессом $BUSY — туннель не поднимаю"
      exit 1
    fi
    if tmux has-session -t "$SESSION" 2>/dev/null && alive; then
      echo "туннель уже работает"
      exit 0
    fi
    # чужие одиночные ssh -fN из прошлых запусков больше не нужны
    pkill -f "ssh -fN -L $LPORT:127.0.0.1:$RPORT" 2>/dev/null || true
    tmux kill-session -t "$SESSION" 2>/dev/null || true
    # ControlMaster=no: иначе форвард уходит в мультиплексор, живёт отдельным
    # процессом и цикл переподключения ничего не замечает
    tmux new-session -d -s "$SESSION" \
      "while true; do \
         echo \"[\$(date +%H:%M:%S)] подключаюсь\"; \
         ssh -N -L $LPORT:127.0.0.1:$RPORT \
             -o ControlMaster=no -o ControlPath=none \
             -o ServerAliveInterval=20 -o ServerAliveCountMax=3 \
             -o ExitOnForwardFailure=yes $HOST; \
         echo \"[\$(date +%H:%M:%S)] оборвалось, через 3 с ещё раз\"; \
         sleep 3; \
       done"
    for _ in $(seq 1 20); do
      sleep 0.5
      alive && { echo "туннель поднят (tmux: $SESSION, порт $LPORT)"; exit 0; }
    done
    echo "не поднялся; смотри: $0 log"
    exit 1
    ;;
esac
