#!/usr/bin/env bash
# Everything that can be checked without a live session. Run from the repo root:
#   ./tests/run.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PYTHON_BIN:-python3}"
fail=0

echo "== shell syntax"
for f in "$ROOT"/shared/*.sh "$ROOT"/skills/*/scripts/*.sh "$ROOT"/skills/*/bridge/*.sh "$ROOT"/tests/*.sh; do
  bash -n "$f" || { echo "  FAIL $f"; fail=1; }
done

echo "== python compiles"
"$PY" -m compileall -q "$ROOT/shared" "$ROOT/skills" >/dev/null || fail=1

echo "== node parses"
# Все скиллы, а не один: раньше путь был вшит как shopee-vn и после
# переименования каталога тест молча проверял пустоту.
for f in "$ROOT"/skills/*/scripts/*.cjs "$ROOT"/skills/*/scripts/js/*.js; do
  [ -e "$f" ] || continue
  node --check "$f" || { echo "  FAIL $f"; fail=1; }
done

echo "== unit tests"
"$PY" "$ROOT/tests/test_units.py" || fail=1

echo "== no secrets / no machine paths in tracked files"
# Сам этот файл содержит искомый шаблон, поэтому исключён — иначе тест
# всегда падал на собственной строке.
if git -C "$ROOT" ls-files -z -- ':!tests/run.sh' | xargs -0 grep -nE '/Users/|/home/[a-z]|tg_agent|naked/|c_user=|xs=[A-Za-z0-9]|api_hash *= *[0-9a-f]{32}' ; then
  echo "  FAIL: leaked path or credential above"; fail=1
fi

[ "$fail" = 0 ] && echo "ALL OK" || echo "FAILURES"
exit $fail
