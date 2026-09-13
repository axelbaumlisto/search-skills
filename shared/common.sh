# Shared shell preamble for every wrapper: config home, interpreter, .env, help.
# Source it, do not execute it:  . "$(dirname "$0")/../../../shared/common.sh"

# ~ inside an env value is never expanded by the shell; do it once, here.
expand_tilde() { case "$1" in "~/"*) printf '%s' "$HOME/${1#\~/}";; *) printf '%s' "$1";; esac; }

SEARCH_SKILLS_ENV="${SEARCH_SKILLS_ENV:-$HOME/.config/search-skills/.env}"
if [ -f "$SEARCH_SKILLS_ENV" ]; then set -a; . "$SEARCH_SKILLS_ENV"; set +a; fi

CONF_DIR="$(expand_tilde "${SEARCH_SKILLS_HOME:-$HOME/.config/search-skills}")"
PY="${PYTHON_BIN:-python3}"
CHROME_PROFILE="${CHROME_PROFILE:-Default}"
mkdir -p "$CONF_DIR"

# Print the leading comment block of a script as its help text.
show_help() { awk 'NR>1 && /^#/ {sub(/^# ?/,""); print; next} NR>1 {exit}' "$1"; }
