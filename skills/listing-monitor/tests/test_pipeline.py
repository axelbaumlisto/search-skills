from datetime import datetime, timezone

from listing_monitor.filters import matches
from listing_monitor.geo import distance_km, guess_coords
from listing_monitor.models import Listing
from listing_monitor.report import render_markdown, render_message
from listing_monitor.store import State


def L(**kw):
    base = dict(source="t", url="u", title="Cho thuê nhà", text="Cho thuê nhà Phú Quốc", price_vnd=6_000_000,
                bedrooms=2, kind="rent")
    base.update(kw)
    return Listing(**base)


def test_matches_ok(cfg):
    assert matches(L(), cfg) == (True, "ok")


def test_matches_rejects(cfg):
    assert matches(L(price_vnd=None), cfg)[0] is False
    assert matches(L(price_vnd=25_000_000), cfg)[0] is False
    assert matches(L(bedrooms=1), cfg)[0] is False
    assert matches(L(bedrooms=None), cfg)[0] is False
    assert matches(L(kind="sale"), cfg)[0] is False
    assert matches(L(text="Сдам дом в Дананге", title="дом"), cfg)[0] is False     # не тот город
    assert matches(L(price_vnd=500_000), cfg)[0] is False                          # цена за ночь/мусор


def test_rejects_daily_and_foreign_city(cfg):
    assert matches(L(title="Cho thuê Homestay 3 PN Phú Quốc", price_vnd=2_200_000, bedrooms=3), cfg)[0] is False
    assert matches(L(text="Căn hộ Phú Quốc 1tr500k/ đêm", price_vnd=6_000_000), cfg)[0] is False
    assert matches(L(title="Квартира в аренду – Северный Нячанг", text="2 спальни", geo_bound=True), cfg)[0] is False


def test_geo_bound_source_skips_city_check(cfg):
    assert matches(L(text="Nhà 2 PN", title="Nhà", geo_bound=True), cfg) == (True, "ok")


def test_distance_and_guess(cfg):
    assert round(distance_km(10.19538, 103.96795, 10.19538, 103.96795), 3) == 0
    assert 9 < distance_km(10.19538, 103.96795, 10.1116, 103.9839) < 10.5
    assert guess_coords("между Ong Lang и Duong Dong", cfg.districts) is not None
    assert guess_coords("где-то на острове", cfg.districts) is None


def test_state_new_and_sent(tmp_path):
    s = State.load(tmp_path / "s.json")
    a, b = L(url="a"), L(url="b")
    s.mark_seen([a])
    assert s.new([a, b]) == [b]
    s.mark_sent([b])
    s.save()
    s2 = State.load(tmp_path / "s.json")
    assert s2.new([a, b]) == [] and "b" in s2.sent


def test_render(cfg):
    x = L(url="https://t.me/x/1", title="Дом", price_vnd=5_500_000, lat=10.2, lng=103.97)
    md = render_markdown([x], cfg, stamp="2026-09-26 21:00")
    assert "5,5" in md and "https://t.me/x/1" in md and "## Свежие — 2026-09-26 21:00" in md
    msg = render_message([x], cfg, stamp="26.09 21:00")
    assert msg.splitlines()[0] == "test — новые объявления (26.09 21:00)"
    assert "5,5 млн" in msg and "2 спальни" in msg and "https://t.me/x/1" in msg
    assert render_message([], cfg, stamp="x") == ""


def test_render_unknown_distance_and_pipe(cfg):
    x = L(url="https://f/1", title="3PN | HOUSE", area="Phú Quốc, Kiên Giang", price_vnd=8_000_000)
    msg = render_message([x], cfg, stamp="s")
    assert "?" not in msg and "км" not in msg
    md = render_markdown([x], cfg, stamp="s")
    row = [r for r in md.splitlines() if "https://f/1" in r][0]
    assert row.count("|") == 9            # 8 колонок — «|» из заголовка экранирован


def test_message_group_then_post_and_no_internal_noise(cfg):
    tg = L(source="telegram", url="https://t.me/phuquoc_rent/55", title="Сдам дом 2 спальни", price_vnd=9_000_000,
           group_url="https://t.me/phuquoc_rent", group_name="Фукуок аренда")
    fb = L(source="facebook", url="https://www.facebook.com/marketplace/item/1/",
           title="🏡 CHO THUÊ NHÀ 3PN CÓ HỒ BƠI RIÊNG | 3-BEDROOM HOUSE", area="Phú Quốc, Kiên Giang",
           price_vnd=18_000_000, bedrooms=3)
    msg = render_message([tg, fb], cfg, stamp="s")
    g, p = msg.index("https://t.me/phuquoc_rent\n"), msg.index("https://t.me/phuquoc_rent/55")
    assert g < p and "Фукуок аренда" in msg
    assert "вход в Facebook" in msg
    for noise in ("?", "Kiên Giang", "KingKong", "🏡", "3-BEDROOM"):
        assert noise not in msg, noise
    assert "CHO THUÊ NHÀ 3PN CÓ HỒ BƠI RIÊNG" in msg
