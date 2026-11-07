# общий кэш для скиллов homepro-th / globalhouse-th
THAI_CACHE="$HOME/.cache/thai-materials"; mkdir -p "$THAI_CACHE"
_thai_key() { printf '%s|%s|%s' "$1" "$2" "$3" | md5 -q 2>/dev/null || printf '%s|%s|%s' "$1" "$2" "$3" | md5sum | cut -d' ' -f1; }
# _thai_cached <site> <query> <extra> <команда-печатающая-json>
_thai_cached() {
  local f="$THAI_CACHE/$1_$(_thai_key "$1" "$2" "$3").json"
  if [ "${THAI_NO_CACHE:-0}" = 0 ] && [ -f "$f" ] && [ $(( $(date +%s) - $(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f") )) -lt 3600 ]; then
    cat "$f"; return 0
  fi
  eval "$4" > "$f" 2>/dev/null; cat "$f"
}
