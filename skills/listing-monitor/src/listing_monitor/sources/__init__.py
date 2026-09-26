"""Реестр источников. Новый источник = новый модуль с fetch(cfg, since) и, по желанию,
enrich(cfg, items); плюс строка здесь. Конвейер и CLI про конкретные сайты не знают."""
from . import chotot, facebook, muaban, telegram

REGISTRY = {"chotot": chotot, "facebook": facebook, "telegram": telegram, "muaban": muaban}


def enabled(cfg) -> dict:
    return {name: mod for name, mod in REGISTRY.items() if getattr(cfg, name, None)}
