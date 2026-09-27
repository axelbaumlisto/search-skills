"""Выполнение JS в живом локальном Chrome через ChromeBridge.app.

Зачем отдельный модуль: локальный Chrome запущен на обычном профиле, где
`--remote-debugging-port` игнорируется (Chrome 136+), поэтому CDP недоступен,
а сессии Facebook/Instagram/Shopee живут именно там. Остаётся AppleScript.

    from chromebridge import Chrome
    ch = Chrome()
    ch.goto('https://www.facebook.com/groups/123/about')
    print(ch.text()[:500])
    rows = ch.json("[].slice.call(document.querySelectorAll('img')).map(i=>i.src)")

Грабли, которые модуль закрывает:
  - в Chrome должно быть включено «Вид → Разработчикам → Разрешить JavaScript
    из событий Apple»; иначе ошибка 12 — она выбрасывается понятным текстом;
  - если запущено несколько инстансов Chrome (например автоматизационный с
    `--user-data-dir=/tmp/...`), AppleScript попадает не в тот; `check()`
    показывает это до того, как ты потеряешь час;
  - экранирование JS внутри AppleScript-строки сделано один раз здесь.
"""
import json
import subprocess
import time
from pathlib import Path

BRIDGE_APP = '/Applications/ChromeBridge.app'
AS_FILE = Path('/tmp/shopee_as.applescript')
OUT_FILE = Path('/tmp/shopee_js.out')
QUIT_FILE = Path('/tmp/shopee_job.quit')


class BridgeError(RuntimeError):
    pass


class Chrome:
    def __init__(self, wait: int = 45, settle: float = 0.8):
        self.wait = wait
        self.settle = settle

    # --- базовое ---------------------------------------------------------
    def js(self, code: str, wait: int | None = None) -> str:
        """Выполнить JS в активной вкладке и вернуть результат строкой."""
        QUIT_FILE.write_text('')
        time.sleep(self.settle)
        esc = code.replace('\\', '\\\\').replace('"', '\\"')
        AS_FILE.write_text(
            'tell application "Google Chrome"\n'
            '\ttell active tab of first window\n'
            f'\t\tset r to execute javascript "{esc}"\n'
            '\tend tell\n'
            '\treturn (r as text)\n'
            'end tell\n', encoding='utf-8')
        if OUT_FILE.exists():
            OUT_FILE.unlink()
        subprocess.run(['open', '-g', '-a', BRIDGE_APP], check=False)
        for _ in range(wait or self.wait):
            time.sleep(1)
            if OUT_FILE.exists() and OUT_FILE.stat().st_size:
                break
        raw = OUT_FILE.read_text(encoding='utf-8', errors='ignore') if OUT_FILE.exists() else ''
        out = raw[3:].strip() if raw.startswith('OK ') else raw.strip()
        if 'JavaScript' in out and ('отключено' in out or 'disabled' in out):
            raise BridgeError(
                'Chrome запрещает JS из Apple Events. Включить: Вид → Разработчикам → '
                'Разрешить JavaScript из событий Apple. Если галочка стоит — проверь '
                'Chrome.check(): скорее всего запущен второй инстанс с другим профилем.')
        return out

    def json(self, code: str, default=None, wait: int | None = None):
        """JS, результат которого — JSON. Вернёт default, если не распарсилось."""
        raw = self.js(f'(function(){{return JSON.stringify({code})}})()', wait=wait)
        try:
            return json.loads(raw)
        except Exception:
            return default

    # --- навигация и съём ------------------------------------------------
    def goto(self, url: str, settle: float = 8.0) -> str:
        r = self.js(f"(function(){{location.href='{url}';return 'go'}})()")
        time.sleep(settle)
        return r

    def url(self) -> str:
        return self.js('(function(){return location.href})()')

    def text(self, limit: int = 4000) -> str:
        return self.json(
            f"(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,{limit})", default='')

    def images(self, min_width: int = 300) -> list:
        return self.json(
            "[].slice.call(document.querySelectorAll('img'))"
            ".filter(function(i){return i.src&&i.src.indexOf('data:')!==0"
            f"&&i.naturalWidth>={min_width}}})"
            ".map(function(i){return {src:i.src,alt:(i.alt||'').slice(0,100),"
            "w:i.naturalWidth,h:i.naturalHeight}}).slice(0,40)", default=[])

    def scroll(self, times: int = 3, pause: float = 3.0) -> None:
        for _ in range(times):
            self.js('(function(){window.scrollBy(0,1400);return 1})()')
            time.sleep(pause)

    # --- диагностика -----------------------------------------------------
    @staticmethod
    def _parse_ps(lines: list[str]) -> list[dict]:
        """Из вывода ps оставить только главные процессы браузера, с профилями."""
        out = []
        for line in lines:
            parts = line.split()
            if len(parts) < 2:
                continue
            pid, cmd = parts[0], line.split(None, 1)[1]
            if not cmd.split(' --')[0].endswith('MacOS/Google Chrome'):
                continue            # хелперы (Renderer/GPU) — не инстансы
            if '--type=' in cmd:
                continue
            prof = next((x.split('=', 1)[1] for x in cmd.split() if x.startswith('--user-data-dir=')),
                        'профиль по умолчанию')
            out.append({'pid': pid, 'profile': prof})
        return out

    @classmethod
    def check(cls) -> dict:
        """Сколько инстансов Chrome и с какими профилями — причина 90% сбоев."""
        lines = subprocess.run(['ps', '-eo', 'pid=,command='],
                               capture_output=True, text=True).stdout.splitlines()
        out = cls._parse_ps(lines)
        return {'инстансов': len(out), 'детали': out,
                'подсказка': 'лишние автоматизационные инстансы перехватывают AppleScript — kill'}


if __name__ == '__main__':
    import pprint
    pprint.pp(Chrome.check())
