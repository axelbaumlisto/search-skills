---
name: homepro-th
description: Цены и наличие стройматериалов и товаров для дома на сайте HomePro Thailand (homepro.co.th) — поиск по запросу, цена, английское и тайское название, ссылка на карточку. Без браузера и без маркетплейсов. Use when you need a Thai shelf price from HomePro to check a supplier quote or build a bill of materials — "сколько стоит в HomePro", "проверь цену", "homepro", "плитка/блоки/клей/арматура в Таиланде".
---

# HomePro (homepro.co.th): цены по запросу

Скилл только про **HomePro**. Второй сайт — отдельный скилл `globalhouse-th`.

```bash
S=~/.pi/agent/skills/homepro-th/scripts
$S/hp.sh "อิฐแก้ว 19x19x8"        # стеклоблок: 58 позиций, ฿50–51
$S/hp.sh "กาวยาแนวบล็อกแก้ว"      # затирка จระเข้: ฿55, /p/185718
$S/hp.sh "ตะแกรงเหล็ก" --no-cache
```

Вывод: `฿цена  тайское название` + строка `английское название  ссылка` на `/p/<id>`.

## Как устроено (не переоткрывать)

- Браузер не нужен. Основной источник — официальный структурированный endpoint
  `https://www.homepro.co.th/service/search/suggest.jsp?q=<utf8>`: до 20 товаров, текущая и
  старая цена, Thai/English name и `partnumber` → `/p/<id>`.
- Старый `/search?q=` с SSR-полями `gtm*` оставлен fallback, но с ноября 2026 HomePro
  отвечает ему HTTP 403. Скрипт больше не превращает 403 в ложное «0 товаров».
- Для больших выборок уточняйте запрос: suggestion endpoint отдаёт только наиболее
  релевантные карточки, не полный каталог.
- Ответы кэшируются на час (`~/.cache/thai-materials`), `--no-cache` обходит.

## Грабли

1. Без браузерного User-Agent часть ответов режется.
2. Парсер держится на служебных полях `gtm*` — если HomePro переверстает, сломается.
   Поэтому есть самопроверка: `python3 ~/.pi/agent/skills/_thai_shared/selftest.py`.
3. Маркетплейсы (Shopee/Lazada) не используются: те же блоки там ฿64–65 против ฿50–51 на сайте.
