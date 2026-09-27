"""Запуск команды на хосте с общим браузером: отсоединённо + опрос.

Обычный `ssh host python3 ...` обрывается по таймауту, пока удалённый процесс
продолжает держать браузер, поэтому запускаем через nohup и ждём файл-маркер."""
from __future__ import annotations

import shlex
import subprocess
import time
import uuid

SSH = ["ssh", "-n", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes"]


def _ssh(host: str, cmd: str, timeout: int = 30) -> str:
    r = subprocess.run([*SSH, host, cmd], capture_output=True, text=True, timeout=timeout)
    return r.stdout


def run_detached(host: str, cmd: str, timeout: int = 240, lock: str = "/tmp/fb-browser.lock") -> str:
    tag = f"/tmp/rm-{uuid.uuid4().hex[:10]}"
    wrapped = f"flock -w 300 {lock} sh -c {shlex.quote(cmd)} > {tag}.out 2> {tag}.err; touch {tag}.done"
    _ssh(host, f"nohup sh -c {shlex.quote(wrapped)} >/dev/null 2>&1 &")
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(5)
        if "DONE" in _ssh(host, f"test -f {tag}.done && echo DONE"):
            out = _ssh(host, f"cat {tag}.out; rm -f {tag}.out {tag}.err {tag}.done", timeout=60)
            return out
    _ssh(host, f"pkill -f {shlex.quote(tag)} ; rm -f {tag}.*")
    raise TimeoutError(f"remote job on {host} did not finish in {timeout}s")


def put_file(host: str, local_text: str, remote_path: str, mkdir: str | None = None) -> None:
    pre = f"mkdir -p {shlex.quote(mkdir)} && " if mkdir else ""
    subprocess.run(["ssh", "-o", "ConnectTimeout=10", "-o", "BatchMode=yes", host,
                    f"{pre}cat > {shlex.quote(remote_path)}"],
                   input=local_text, text=True, check=True, timeout=30, capture_output=True)


def remote_path(p: str) -> str:
    """Путь для команды на удалённом хосте: «~/» раскрывается там, а не здесь."""
    return '"$HOME"/' + shlex.quote(p[2:]) if p.startswith("~/") else shlex.quote(p)
