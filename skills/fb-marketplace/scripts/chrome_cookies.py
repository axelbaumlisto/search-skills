#!/usr/bin/env python3
"""Export cookies for a host from the local Chrome profile into Netscape format.

Why: a Facebook session is bound to the machine and IP that created it. Reusing
the server's cookies from a laptop (or vice versa) looks like session hijacking
to Meta's risk scoring. If you are logged into Facebook in the local Chrome,
those cookies are the safe ones to automate with *from this machine*.

macOS Chrome encrypts cookie values with AES-128-CBC; the key is derived from
the "Chrome Safe Storage" Keychain entry (PBKDF2-HMAC-SHA1, salt=b"saltysalt",
1003 iterations). Reading the Keychain may raise a system prompt the first time.

Usage:
    chrome_cookies.py facebook.com
    chrome_cookies.py facebook.com --out ~/work/tg_agent/naked/.secrets/cookies/facebook.cookies.txt
    chrome_cookies.py facebook.com --profile "Profile 1"
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CHROME = Path.home() / "Library" / "Application Support" / "Google" / "Chrome"
SALT = b"saltysalt"
IV = b" " * 16
ITERATIONS = 1003


def keychain_key() -> bytes:
    try:
        pw = subprocess.run(
            ["security", "find-generic-password", "-s", "Chrome Safe Storage", "-w"],
            capture_output=True, text=True, timeout=30, check=True).stdout.strip()
    except subprocess.CalledProcessError as exc:
        raise SystemExit("cannot read the 'Chrome Safe Storage' Keychain entry "
                         "(approve the prompt, or unlock the login keychain)") from exc
    from Crypto.Hash import SHA1
    from Crypto.Protocol.KDF import PBKDF2
    return PBKDF2(pw.encode(), SALT, dkLen=16, count=ITERATIONS,
                  hmac_hash_module=SHA1)


def decrypt(blob: bytes, key: bytes) -> str:
    if not blob:
        return ""
    if blob[:3] not in (b"v10", b"v11"):
        return blob.decode("utf-8", "replace")  # legacy plaintext
    from Crypto.Cipher import AES
    data = AES.new(key, AES.MODE_CBC, IV).decrypt(blob[3:])
    data = data[: -data[-1]] if data and data[-1] <= 16 else data  # strip padding
    # Chrome >= 130 prefixes a 32-byte SHA256 of the domain before the value
    for cut in (0, 32):
        try:
            text = data[cut:].decode("utf-8")
            if text.isprintable() or cut:
                return text
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", "replace")


def export(host: str, profile: str, out: Path | None) -> int:
    src = CHROME / profile / "Cookies"
    if not src.exists():
        raise SystemExit(f"no cookie DB at {src}")
    key = keychain_key()

    # Chrome keeps the DB locked; work on a copy.
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "Cookies"
        shutil.copy2(src, copy)
        con = sqlite3.connect(f"file:{copy}?mode=ro", uri=True)
        rows = con.execute(
            "select host_key, path, is_secure, expires_utc, name, encrypted_value "
            "from cookies where host_key like ? order by name", (f"%{host}%",)).fetchall()
        con.close()

    lines = ["# Netscape HTTP Cookie File",
             f"# exported from Chrome profile {profile!r} for {host} at "
             f"{time.strftime('%Y-%m-%dT%H:%M:%S')}"]
    names = []
    for host_key, path, secure, expires, name, enc in rows:
        value = decrypt(enc, key)
        if not value:
            continue
        # Chrome stores microseconds since 1601-01-01
        exp = int(expires / 1_000_000 - 11_644_473_600) if expires else 0
        lines.append("\t".join([host_key, "TRUE" if host_key.startswith(".") else "FALSE",
                                path, "TRUE" if secure else "FALSE", str(max(exp, 0)),
                                name, value]))
        names.append(name)

    text = "\n".join(lines) + "\n"
    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text)
        out.chmod(0o600)
        print(f"wrote {len(names)} cookies for {host} -> {out}", file=sys.stderr)
    else:
        sys.stdout.write(text)
    print(f"names: {', '.join(names)}", file=sys.stderr)
    if host.endswith("facebook.com") and not {"c_user", "xs"} <= set(names):
        print("WARNING: no c_user/xs — this profile is not logged into Facebook",
              file=sys.stderr)
        return 1
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Export local Chrome cookies (macOS)")
    p.add_argument("host", help="host substring, e.g. facebook.com")
    p.add_argument("--profile", default="Default")
    p.add_argument("--out", type=Path)
    a = p.parse_args()
    return export(a.host, a.profile, a.out)


if __name__ == "__main__":
    raise SystemExit(main())
