#!/usr/bin/env python3
"""Генератор VietQR (napas247) — платёжный QR для вьетнамских банков.

Пример:
    ./vietqr.py --bank bidv --acc 0123456789 --amount 1500000 \
        --info "ACME 0123456789 TT HD-DEMO-01" --name "CONG TY TNHH ACME"

Файл кладётся на ~/Desktop и открывается. Несколько платежей — через --batch.
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import urllib.parse
import urllib.request

# BIN-коды napas. Полный список: https://api.vietqr.io/v2/banks
BANKS = {
    "vietcombank": "970436", "vcb": "970436",
    "bidv": "970418",
    "vietinbank": "970415", "ctg": "970415",
    "agribank": "970405",
    "techcombank": "970407", "tcb": "970407",
    "mbbank": "970422", "mb": "970422",
    "acb": "970416",
    "vpbank": "970432", "vpb": "970432",
    "sacombank": "970403", "stb": "970403",
    "tpbank": "970423", "tpb": "970423",
    "hdbank": "970437",
    "vib": "970441",
    "shb": "970443",
    "ocb": "970448",
    "msb": "970426",
    "seabank": "970440",
    "eximbank": "970431",
    "scb": "970429",
    "lpbank": "970449", "lienvietpostbank": "970449",
    "namabank": "970428",
    "bacabank": "970409",
    "pvcombank": "970412",
    "abbank": "970425",
    "vietabank": "970427",
    "baovietbank": "970438",
    "vietbank": "970433",
    "kienlongbank": "970452",
    "saigonbank": "970400",
    "cake": "546034",
    "timo": "963388",
    "ubank": "546035",
    "vietcapitalbank": "970454", "bvbank": "970454",
    "cimb": "422589",
    "woori": "970457",
    "shinhan": "970424",
    "publicbank": "970439",
    "hongleong": "970442",
    "standardchartered": "970410",
    "indovinabank": "970434",
    "nonghyup": "801011",
    "ibkhn": "970455", "ibkhcm": "970456",
    "dbsbank": "796500",
    "kbank": "668888",
    "kookminhn": "970462", "kookminhcm": "970463",
    "coopbank": "970446",
    "vrb": "970421",
    "hsbc": "458761",
}

ASCII_OK = re.compile(r"[^A-Za-z0-9 .,\-/]")


def deaccent(text: str) -> str:
    """Вьетнамские банки режут диакритику в назначении платежа — снимаем заранее."""
    text = text.replace("Đ", "D").replace("đ", "d")
    text = unicodedata.normalize("NFD", text)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    return ASCII_OK.sub(" ", text).strip()


def resolve_bank(value: str) -> str:
    key = value.lower().replace(" ", "")
    if key.isdigit() and len(key) == 6:
        return key
    if key in BANKS:
        return BANKS[key]
    sys.exit(f"неизвестный банк: {value}. Укажи BIN цифрами или см. BANKS в скрипте")


def build(bank: str, acc: str, amount: str, info: str, name: str, template: str) -> str:
    params = {"addInfo": deaccent(info)}
    if amount:
        params["amount"] = str(int(str(amount).replace(".", "").replace(",", "").replace(" ", "")))
    if name:
        params["accountName"] = deaccent(name)
    return f"https://img.vietqr.io/image/{bank}-{acc}-{template}.png?{urllib.parse.urlencode(params)}"


def fetch(url: str, out: str) -> str:
    """Fetch the official render and write atomically.

    img.vietqr.io now redirects historical *.png URLs to SVG. Accept both: SVG is
    the same official QR, and ImageMagick renders it back to the promised PNG.
    Never open the destination before the payload has been validated and rendered.
    """
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = resp.read()
        content_type = resp.headers.get_content_type()
    out = os.path.abspath(os.path.expanduser(out))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    if data.startswith(b"\x89PNG"):
        fd, tmp = tempfile.mkstemp(prefix=".vietqr-", suffix=".png", dir=os.path.dirname(out))
        try:
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            os.replace(tmp, out)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
        return out
    if data.lstrip().startswith(b"<svg") or content_type == "image/svg+xml":
        magick = shutil.which("magick")
        if not magick:
            sys.exit("vietqr.io вернул SVG; для PNG установи ImageMagick (команда magick)")
        with tempfile.TemporaryDirectory(prefix="vietqr-") as td:
            svg = os.path.join(td, "source.svg")
            png = os.path.join(td, "result.png")
            with open(svg, "wb") as fh:
                fh.write(data)
            p = subprocess.run([magick, "-background", "white", svg, png],
                               capture_output=True, text=True)
            if p.returncode or not os.path.exists(png):
                sys.exit(f"не удалось преобразовать VietQR SVG в PNG: {p.stderr[:160]}")
            os.replace(png, out)
        return out
    sys.exit(f"vietqr.io вернул неожиданный {content_type} ({len(data)} байт) — проверь счёт и BIN")


def main() -> None:
    ap = argparse.ArgumentParser(description="Сгенерировать VietQR для перевода")
    ap.add_argument("--bank", required=True, help="имя банка (bidv, vcb, tcb...) или BIN из 6 цифр")
    ap.add_argument("--acc", required=True, help="номер счёта получателя")
    ap.add_argument("--amount", default="", help="сумма в донгах; пусто = плательщик вводит сам")
    ap.add_argument("--info", default="", help="назначение платежа")
    ap.add_argument("--name", default="", help="имя получателя (для подписи под QR)")
    ap.add_argument("--out", default="", help="путь к PNG; по умолчанию ~/Desktop/vietqr_<сумма>.png")
    ap.add_argument("--template", default="compact2",
                    choices=["compact", "compact2", "qr_only", "print"],
                    help="compact2 = QR + сумма + получатель (по умолчанию)")
    ap.add_argument("--no-open", action="store_true", help="не открывать файл после создания")
    args = ap.parse_args()

    bank = resolve_bank(args.bank)
    url = build(bank, args.acc, args.amount, args.info, args.name, args.template)
    out = args.out or os.path.expanduser(
        f"~/Desktop/vietqr_{args.amount or 'open'}.png")
    fetch(url, out)
    print(out)
    if not args.no_open and sys.platform == "darwin":
        subprocess.run(["open", out], check=False)


if __name__ == "__main__":
    main()
