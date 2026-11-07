# _thai_shared — общий код скиллов `homepro-th` и `globalhouse-th`

Это **не скилл** (нет SKILL.md), а общий пакет, чтобы два скилла не дублировали парсеры,
кэш и форматтер:

| файл | что |
|---|---|
| `hp.py` | HomePro: официальный suggest JSON (цены + Thai/English names), SSR fallback |
| `gh.py` | сборщик Global House (браузер по CDP, `?keyword=`, постраничная выдача) |
| `format.py` | единый вывод: цена, название, ссылка |
| `cache.sh` | кэш ответов на 1 час (`~/.cache/thai-materials`) |
| `selftest.py` | самопроверка обоих каналов: `python3 selftest.py` |

Меняешь парсер — правь здесь, оба скилла получат изменение сразу.
