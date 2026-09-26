"""Один движок для любой категории: аренда жилья, продажа велосипедов, любой город."""
import pytest

from listing_monitor.config import load_config
from listing_monitor.filters import matches
from listing_monitor.geo import guess_coords
from listing_monitor.models import Listing
from listing_monitor.parse import is_offer
from listing_monitor.report import render_message
from listing_monitor.sources import chotot, telegram

BIKES = """
name = "Дананг — шоссейники"
offer = "sale"
max_price_vnd = 15_000_000
min_price_vnd = 1_000_000
city_keywords = ["дананг", "đà nẵng", "da nang", "danang"]
include_any = ["đua", "road", "шоссе", "carbon", "105", "tiagra", "sora"]
exclude_keywords = ["giày", "điện", "trẻ em"]

[chotot]
region_v2 = 3017
categories = [2060]
"""


@pytest.fixture
def bikes(tmp_path):
    p = tmp_path / "b.toml"
    p.write_text(BIKES)
    return load_config(p)


def L(**kw):
    d = dict(source="facebook", url="u", title="Xe đạp đua Giant nhôm", price_vnd=5_000_000, geo_bound=True)
    d.update(kw)
    return Listing(**d)


@pytest.mark.parametrize("text,offer,ok", [
    ("Продам велосипед Trek, 3 млн", "sale", True),
    ("Bán xe đạp đua Twitter carbon", "sale", True),
    ("Thanh lý xe đạp", "sale", True),
    ("Куплю шоссейник до 10 млн", "sale", False),
    ("Cần mua xe đạp đua cũ", "sale", False),
    ("Сдам дом 2 спальни", "sale", False),
    ("Сдам дом 2 спальни", "rent", True),
    ("Ищу дом в аренду", "rent", False),
])
def test_is_offer(text, offer, ok):
    assert is_offer(text, offer) is ok


def test_sale_filter_needs_no_bedrooms_but_include_any(bikes):
    assert matches(L(), bikes) == (True, "ok")
    assert matches(L(title="Xe đạp mini cho bé"), bikes)[0] is False            # нет ключевых слов категории
    assert matches(L(title="Xe đạp điện đua"), bikes)[0] is False               # исключение
    assert matches(L(price_vnd=20_000_000), bikes)[0] is False


def test_chotot_offer_type_follows_config(bikes, fixture_json):
    raw = {"ads": [{"list_id": 1, "type": "s", "subject": "Xe đạp đua", "price": 5_000_000},
                   {"list_id": 2, "type": "u", "subject": "Cho thuê xe đạp", "price": 100_000}]}
    assert [x.url for x in chotot.parse(raw, offer="sale")] == ["https://www.chotot.com/1.htm"]
    assert chotot.query_url(bikes, 2060, 0).endswith("cg=2060&region_v2=3017&st=s,k&limit=50&o=0")


def test_telegram_parse_uses_offer():
    msgs = [{"id": 1, "chat_username": "danang3", "chat_title": "Дананг", "author": "a", "date": "2026-09-26T00:00:00+00:00",
             "text": "Продам велосипед Cannondale Tiagra, 9 mln"},
            {"id": 2, "chat_username": "danang3", "chat_title": "Дананг", "author": "b", "date": "2026-09-26T00:00:00+00:00",
             "text": "Куплю велосипед"}]
    assert [x.url for x in telegram.parse(msgs, offer="sale")] == ["https://t.me/danang3/1"]


def test_sale_message_has_no_month_or_bedrooms(bikes):
    msg = render_message([L(title="Xe đạp đua Giant", price_vnd=4_000_000)], bikes, stamp="s")
    assert "4 млн" in msg and "/мес" not in msg and "спальн" not in msg


def test_districts_come_from_config(tmp_path):
    p = tmp_path / "c.toml"
    p.write_text('name="x"\nmax_price_vnd=1\ncity_keywords=[]\n[districts]\n"sơn trà" = [16.08, 108.24]\n')
    c = load_config(p)
    assert guess_coords("nhà ở Sơn Trà", c.districts) == (16.08, 108.24)
    assert guess_coords("nhà ở Dương Đông", c.districts) is None


def test_facebook_geo_by_city_preset_or_coords():
    from types import SimpleNamespace
    from listing_monitor.sources.facebook import search_args
    c = SimpleNamespace(facebook={"city": "danang", "limit": 20})
    assert search_args(c, "xe đạp đua") == "search --query 'xe đạp đua' --limit 20 --city danang --local-only"
    c = SimpleNamespace(facebook={"lat": 10.2, "lng": 103.9, "radius_km": 25})
    assert search_args(c, "house") == "search --query house --limit 30 --lat 10.2 --lng 103.9 --radius-km 25 --local-only"


def test_telegram_chat_allowlist_marks_city():
    msgs = [{"id": 1, "chat_username": "danang3", "chat_title": "Дананг", "author": "a", "date": "2026-09-26T00:00:00+00:00",
             "text": "Продам велосипед Trek"},
            {"id": 2, "chat_username": "hanoi_chat", "chat_title": "Ханой", "author": "b", "date": "2026-09-26T00:00:00+00:00",
             "text": "Продам велосипед Giant"}]
    items = telegram.parse(msgs, offer="sale", chats=["danang3"])
    assert [(x.url, x.geo_bound) for x in items] == [("https://t.me/danang3/1", True)]
    assert all(not x.geo_bound for x in telegram.parse(msgs, offer="sale"))


@pytest.mark.parametrize("price", [1_234_567, 9_999_999, 123_456_789, 1_111_111])
def test_placeholder_prices_count_as_unknown(bikes, price):
    assert matches(L(price_vnd=price), bikes) == (False, "нет цены")


def test_refresh_window_override(cfg, tmp_path):
    from datetime import datetime, timedelta, timezone
    from listing_monitor.pipeline import refresh
    cfg.state_path, cfg.master_path = tmp_path / "s.json", tmp_path / "m.md"
    seen = []
    now = datetime(2026, 9, 26, tzinfo=timezone.utc)
    refresh(cfg, sources={"x": lambda c, since: seen.append(since) or []}, now=now, dry_run=True, since_days=30)
    assert seen == [now - timedelta(days=30)]


def test_kind_must_match_offer(bikes):
    assert matches(L(kind="sale"), bikes)[0] is True
    assert matches(L(kind="rent"), bikes)[0] is False
    assert matches(L(kind="expired"), bikes)[0] is False


@pytest.mark.parametrize("text,v", [("Продаю в связи с переездом. 9 mln.", 9_000_000),
                                    ("Size M 56cm Price : 12.8mill", 12_800_000),
                                    ("price 12 million", 12_000_000)])
def test_price_mln_mill_million(text, v):
    from listing_monitor.parse import parse_price_vnd
    assert parse_price_vnd(text) == v


def test_facebook_enrich_only_what_filter_needs(bikes, monkeypatch):
    from listing_monitor.sources import facebook
    calls = []
    monkeypatch.setattr(facebook, "_run", lambda cfg, a: calls.append(a) or {"description": "giá 5tr"})
    bikes.facebook = {"max_details": 5}
    facebook.enrich(bikes, [L(url="https://f/item/1/", price_vnd=5_000_000, bedrooms=None),
                            L(url="https://f/item/2/", price_vnd=None)])
    assert calls == ["detail --item-id 2"]            # спальни для велосипеда не нужны


@pytest.mark.parametrize("field,title,v", [
    ("₫10,500", "Roadbike Merida Reacto", 10_500_000),     # цена в тысячах — обычай VN-продавцов на FB
    ("₫4,500", "Roadbike California R680", 4_500_000),
    ("₫12,800", "Price : 12.8mill", 12_800_000),            # в тексте явнее — берём текст
    ("₫850,000", "Xe đạp ASAMA", 850_000),
    ("₫1", "Xe đạp", None),                                 # «₫1» — цены нет
])
def test_facebook_price_in_thousands(field, title, v):
    from listing_monitor.sources.facebook import _price
    assert _price(field, title) == v


def test_guessed_price_is_marked_in_message(bikes):
    from listing_monitor.sources.facebook import parse_search
    x = parse_search({"listings": [{"url": "https://f/item/9/", "title": "Luxury 5BR Villa", "price": "₫7,500"}]})[0]
    assert x.price_vnd == 7_500_000 and x.price_note == "₫7,500"
    msg = render_message([x], bikes, stamp="s")
    assert "~7,5 млн" in msg and "в объявлении «₫7,500»" in msg


def test_detail_price_replaces_guess(bikes, monkeypatch):
    from listing_monitor.sources import facebook
    monkeypatch.setattr(facebook, "_run", lambda cfg, a: {"description": "Giá thuê 25 triệu/tháng"})
    bikes.facebook = {"max_details": 5}
    x = facebook.enrich(bikes, [L(url="https://f/item/3/", price_vnd=7_500_000, price_note="₫7,500")])[0]
    assert (x.price_vnd, x.price_note) == (25_000_000, "")
