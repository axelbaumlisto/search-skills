#!/usr/bin/env bash
# Facebook cookie store: status / refresh from the local Chrome.
#
#   fb-cookies.sh              # status: age, cookie names, is the session alive
#   fb-cookies.sh refresh      # re-export from local Chrome (Default profile)
#   fb-cookies.sh refresh "Profile 1"
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
CONF_DIR="${SEARCH_SKILLS_HOME:-$HOME/.config/search-skills}"
STORE="${FB_COOKIES:-$CONF_DIR/facebook.cookies.txt}"
PY="${PYTHON_BIN:-python3}"
EXPORTER="${COOKIE_EXPORTER:-$ROOT/shared/chrome_cookies.py}"
mkdir -p "$CONF_DIR"
ACTION="${1:-status}"
PROFILE="${2:-Default}"

if [ "$ACTION" = "refresh" ]; then
  "$PY" "$EXPORTER" facebook.com --profile "$PROFILE" --out "$STORE" || exit 1
  # a fresh export invalidates the cached fb_dtsg of the previous session
  "$PY" - <<'EOF'
import json, os, pathlib
home = pathlib.Path(os.environ.get("SEARCH_SKILLS_HOME") or (pathlib.Path.home() / ".config" / "search-skills"))
p = pathlib.Path(os.environ.get("FB_STATE") or (home / "fb_local_state.json"))
if p.exists():
    st = json.loads(p.read_text()); st.pop("dtsg", None); p.write_text(json.dumps(st))
    print("cleared cached fb_dtsg")
EOF
fi

[ -f "$STORE" ] || { echo "no cookie store at $STORE — run: $0 refresh" >&2; exit 2; }

AGE_S=$(( $(date +%s) - $(stat -f %m "$STORE" 2>/dev/null || stat -c %Y "$STORE") ))
printf 'store   : %s\nage     : %dh %dm\nsource  : %s\n' \
  "$STORE" $((AGE_S/3600)) $(((AGE_S%3600)/60)) \
  "$(grep -m1 '^# exported' "$STORE" 2>/dev/null || echo 'unknown (not a local Chrome export)')"
printf 'cookies : %s\n' "$(awk '!/^#/ && NF>=7 {printf "%s ", $6}' "$STORE")"

HERE="$HERE" FB_STATE="${FB_STATE:-}" SEARCH_SKILLS_HOME="${SEARCH_SKILLS_HOME:-}" "$PY" - <<'EOF'
import os, re, sys
sys.path.insert(0, os.environ["HERE"])
import fb_local as m
try:
    op = m._opener()
    with op.open("https://www.facebook.com/me", timeout=40) as r:
        html, final = m._read(r), r.url
    uid = re.search(r'"USER_ID":"(\d+)"', html)
    if not uid or uid.group(1) == "0":
        print("session : DEAD — run refresh"); raise SystemExit(1)
    print(f"session : alive as uid {uid.group(1)} ({final.rstrip('/').split('/')[-1]})")
except m.FbBlocked as exc:
    print(f"session : FLAGGED — {exc}"); raise SystemExit(4)
except Exception as exc:  # noqa: BLE001
    print(f"session : cannot verify — {exc}"); raise SystemExit(3)

import json, os, time
st = m._load_state()
print(f"budget  : {st.get('count', 0)}/{m.MAX_PER_HOUR} requests this hour"
      f" | pacing {m.MIN_INTERVAL_S}s + up to {m.JITTER_S}s jitter")
EOF
