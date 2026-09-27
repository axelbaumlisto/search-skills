"""Разбор постов групп Facebook — оффлайн, на зафиксированной выдаче."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from listing_monitor.sources import fb_groups

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=timezone.utc)

PAYLOAD = {
    "posts": [
        {   # обычное предложение аренды с ценой и спальнями
            "group": "phuquocrent", "group_url": "https://www.facebook.com/groups/phuquocrent",
            "url": "https://www.facebook.com/groups/phuquocrent/posts/123/",
            "author": "Minh Anh", "time": "3 giờ",
            "text": "Cho thuê nhà nguyên căn 2 phòng ngủ tại Dương Đông, giá 9 triệu/tháng, có máy lạnh",
        },
        {   # спрос, а не предложение — должен отсеяться
            "group": "phuquocrent", "group_url": "https://www.facebook.com/groups/phuquocrent",
            "url": "", "author": "Lan", "time": "Hôm qua",
            "text": "Cần thuê nhà 2 phòng ngủ khu vực Dương Đông, ngân sách 8 triệu, ai có nhà báo mình nhé",
        },
        {   # без постоянной ссылки — падаем на ссылку группы, пост не теряем
            "group": "thanhlydocudn", "group_url": "https://www.facebook.com/groups/thanhlydocudn",
            "url": "https://www.facebook.com/groups/thanhlydocudn",
            "author": "Hùng", "time": "2 ngày",
            "text": "Thanh lý tủ mát 2 cánh còn bảo hành, giá 6.500.000đ, quán đóng cửa nên pass gấp",
        },
    ],
    "errors": [],
}


def test_offer_only():
    items = fb_groups.parse(PAYLOAD, offer="rent", now=NOW)
    assert len(items) == 1, [x.title for x in items]      # спрос и распродажа мебели — не аренда
    x = items[0]
    assert x.source == "fb_groups"
    assert x.price_vnd == 9_000_000
    assert x.bedrooms == 2
    assert x.contact == "Minh Anh"
    assert x.group_url.endswith("/groups/phuquocrent")
    assert x.geo_bound is True


def test_time_parsing():
    assert fb_groups.parse_time("3 giờ", NOW).hour == 9
    assert fb_groups.parse_time("2 ngày", NOW).day == 24
    assert fb_groups.parse_time("Hôm qua", NOW).day == 25
    assert fb_groups.parse_time("", NOW) is None
    assert fb_groups.parse_time("недавно", NOW) is None


def test_url_fallback_keeps_post():
    """Пост без permalink не должен теряться: ссылка на группу лучше, чем ничего."""
    sale = dict(PAYLOAD)
    items = fb_groups.parse(sale, offer="sale", now=NOW)
    urls = [x.url for x in items]
    assert any(u.endswith("/groups/thanhlydocudn") for u in urls), urls


# --- проверка города в Marketplace (баг 26.09.2026: дом из Далата ушёл как Фукуок) ---

def test_facebook_verify_city(monkeypatch):
    """С verify_city карточка дочитывается, и чужой город теряет гео-подтверждение."""
    from listing_monitor.sources import facebook
    from listing_monitor.config import Config
    from listing_monitor.models import Listing

    cfg = Config(name="t", max_price_vnd=20_000_000, min_bedrooms=2,
                 city_keywords=["phú quốc", "phu quoc"], exclude_keywords=["đà lạt"],
                 facebook={"max_details": 5, "verify_city": True})
    details = {"1": {"description": "Cho thuê nhà 2 phòng ngủ Phú Quốc, 9 triệu"},
               "2": {"description": "CHO THUÊ NHÀ 2 PHÒNG NGỦ khu vực Phường 4, Đà Lạt, 8 triệu"}}
    monkeypatch.setattr(facebook, "_run",
                        lambda c, a: details[a.rsplit(" ", 1)[-1]])

    items = [Listing(source="facebook", url="https://f/item/1/", title="2 phòng ngủ Nhà",
                     text="2 phòng ngủ Nhà", price_vnd=9_000_000, bedrooms=2, geo_bound=True),
             Listing(source="facebook", url="https://f/item/2/", title="2 phòng ngủ 3 phòng tắm Nhà",
                     text="2 phòng ngủ 3 phòng tắm Nhà", price_vnd=8_000_000, bedrooms=2, geo_bound=True)]
    out = {x.url: x for x in facebook.enrich(cfg, items)}
    assert out["https://f/item/1/"].geo_bound is True      # Фукуок подтверждён описанием
    assert out["https://f/item/2/"].geo_bound is False     # Далат — не наш город


def test_facebook_without_verify_city_does_not_fetch(monkeypatch):
    """Без флага поведение прежнее: карточка только ради цены и спален."""
    from listing_monitor.sources import facebook
    from listing_monitor.config import Config
    from listing_monitor.models import Listing

    cfg = Config(name="t", max_price_vnd=20_000_000, city_keywords=["phú quốc"], facebook={"max_details": 5})
    calls = []
    monkeypatch.setattr(facebook, "_run", lambda c, a: calls.append(a) or {"description": "giá 5tr"})
    facebook.enrich(cfg, [Listing(source="facebook", url="https://f/item/9/", title="Nhà",
                                  text="Nhà", price_vnd=5_000_000, geo_bound=True)])
    assert calls == []


# --- посуточная/туристическая сдача: брак прохода 26.09.2026 ---

def test_daily_rental_catches_short_term_wording():
    from listing_monitor.parse import is_daily_rental
    # то, на чём фильтр сломался: вилла 5 спален, «7,5 млн», цена только в поле FB
    assert is_daily_rental("Вилла подходит как для короткого, так и для длительного проживания")
    assert is_daily_rental("Suitable for short-term and long-term stay")
    assert is_daily_rental("cho thuê ngắn hạn và dài hạn")
    # обычная долгая аренда мимо фильтра не проходит
    assert not is_daily_rental("Cho thuê nhà nguyên căn 2 phòng ngủ, hợp đồng 12 tháng")
    assert not is_daily_rental("Дом в долгую аренду, договор от года")


def test_sale_listing_rejected_in_rent_monitor():
    """«Bán căn hộ» приезжал из Marketplace в мониторинг аренды (замер 27.09.2026)."""
    from listing_monitor.config import Config
    from listing_monitor.filters import matches
    from listing_monitor.models import Listing

    cfg = Config(name="t", max_price_vnd=20_000_000, min_price_vnd=1_000_000,
                 min_bedrooms=2, city_keywords=["phú quốc"], offer="rent")
    sale = Listing(source="facebook", url="u1", title="Bán căn hộ biển 2 phòng ngủ hướng biển Hillside",
                   text="Bán căn hộ biển 2 phòng ngủ hướng biển Hillside Phú Quốc",
                   price_vnd=7_200_000, bedrooms=2, geo_bound=True)
    rent = Listing(source="facebook", url="u2", title="Cho thuê nhà 2 phòng ngủ Phú Quốc",
                   text="Cho thuê nhà nguyên căn 2 phòng ngủ Phú Quốc, 7 triệu/tháng",
                   price_vnd=7_000_000, bedrooms=2, geo_bound=True)
    assert matches(sale, cfg) == (False, "другой тип сделки")
    assert matches(rent, cfg)[0] is True


def test_recheck_frees_seen_but_keeps_sent(tmp_path):
    """--recheck возвращает в оборот виденное, но не трогает отправленное."""
    import json
    from listing_monitor.store import State

    p = tmp_path / "state.json"
    p.write_text(json.dumps({"seen": ["a", "b", "c"], "sent": ["b"]}))
    st = State.load(p)
    st.seen = set(st.seen) & set(st.sent)      # то, что делает --recheck
    st.save()

    after = json.loads(p.read_text())
    assert after["seen"] == ["b"]              # a и c снова будут оценены
    assert after["sent"] == ["b"]              # b повторно не отправится


def test_links_group_and_post():
    """Человеку нужны обе ссылки: группа (вступить) и сам пост."""
    from listing_monitor.report import _links
    from listing_monitor.models import Listing

    x = Listing(source="fb_groups", url="https://www.facebook.com/photo/?fbid=1&set=pcb.2",
                title="t", text="t", group_url="https://www.facebook.com/groups/g",
                group_name="Phu Quoc Rent")
    out = _links(x)
    assert len(out) == 2
    assert out[0].startswith("   Пост:") and out[0].endswith("fbid=1&set=pcb.2")   # сначала само объявление
    assert "Группа «Phu Quoc Rent»" in out[1] and out[1].endswith("/groups/g")

    # ссылки на пост нет — вторую строку не печатаем, но объясняем, что делать
    y = Listing(source="fb_groups", url="https://www.facebook.com/groups/g", title="t", text="t",
                group_url="https://www.facebook.com/groups/g", group_name="Phu Quoc Rent")
    out2 = _links(y)
    assert len(out2) == 1 and "найди поиском внутри группы" in out2[0]


def test_same_ad_reposted_to_several_groups_sent_once(tmp_path):
    """Один дом в трёх группах = три ссылки. Человеку он нужен один раз."""
    from listing_monitor.store import State
    from listing_monitor.models import Listing

    body = ("CHO THUÊ NHÀ NGUYÊN CĂN 2 PHÒNG NGỦ GẦN KHU ÔNG LANG - PHÚ QUỐC "
            "FULL NỘI THẤT, SÂN VƯỜN, ĐƯỜNG OTO. Giá 15 triệu/tháng.")
    items = [
        Listing(source="fb_groups", url="https://www.facebook.com/photo/?fbid=1&set=pcb.1",
                title=body[:60], text=body),
        # перепечатка: эмодзи, другой перенос строк, свой телефон в конце
        Listing(source="fb_groups", url="https://www.facebook.com/photo/?fbid=2&set=pcb.2",
                title=body[:60], text="🏠 " + body.replace(" - ", "\n– ") + " LH: 0909 111 222"),
        Listing(source="facebook", url="https://www.facebook.com/marketplace/item/9/",
                title=body[:60], text=body.upper()),
    ]
    st = State.load(tmp_path / "s.json")
    assert len(st.new(items)) == 1

    # разные дома с похожим началом не должны схлопываться
    other = Listing(source="fb_groups", url="https://www.facebook.com/photo/?fbid=3&set=pcb.3",
                    title="x", text="CHO THUÊ CĂN HỘ STUDIO TẠI AN THỚI, đầy đủ nội thất, 6 triệu")
    assert len(State.load(tmp_path / "s2.json").new([items[0], other])) == 2


def test_recheck_with_dry_run_does_not_touch_state(tmp_path, monkeypatch):
    """--dry-run обязан быть безвредным: --recheck не должен переписывать state."""
    import json
    from listing_monitor import cli

    state = tmp_path / "s.json"
    state.write_text(json.dumps({"seen": ["a", "b"], "sent": ["b"]}))
    cfg_file = tmp_path / "c.toml"
    cfg_file.write_text(
        f'name = "t"\noffer = "rent"\nmax_price_vnd = 20000000\ncity_keywords = ["phu quoc"]\n'
        f'[paths]\nstate = "{state}"\nmaster = "{tmp_path}/m.md"\n')

    before = state.read_text()
    cli.main(["refresh", "--config", str(cfg_file), "--recheck", "--dry-run"])
    assert state.read_text() == before          # ни байта не изменилось


def test_remote_host_switches_transport(monkeypatch):
    """С remote_host сбор уходит на сервер, без него — в локальный Chrome."""
    from listing_monitor.sources import fb_groups

    calls = []
    monkeypatch.setattr(fb_groups, "_run_remote", lambda g: calls.append("remote") or '{"posts": []}')
    monkeypatch.setattr(fb_groups, "_run_local", lambda g: calls.append("local") or '{"posts": []}')

    cfg = SimpleNamespace(offer="rent", fb_groups={"groups": ["g"], "queries": ["q"], "remote_host": "spex"})
    fb_groups.fetch(cfg)
    cfg_local = SimpleNamespace(offer="rent", fb_groups={"groups": ["g"], "queries": ["q"]})
    fb_groups.fetch(cfg_local)
    assert calls == ["remote", "local"]


def test_errors_without_posts_raise_but_partial_result_survives(monkeypatch):
    """Одна упавшая группа не должна отменять находки остальных."""
    from listing_monitor.sources import fb_groups

    good = ('{"posts": [{"text": "CHO THUÊ NHÀ NGUYÊN CĂN 2 PHÒNG NGỦ giá 8 triệu/tháng tại Phú Quốc", '
            '"url": "https://www.facebook.com/photo/?fbid=1", "group": "g"}], '
            '"errors": [{"group": "g2", "error": "TimeoutError"}]}')
    monkeypatch.setattr(fb_groups, "_run_local", lambda g: good)
    cfg = SimpleNamespace(offer="rent", fb_groups={"groups": ["g"], "queries": ["q"]})
    assert len(fb_groups.fetch(cfg)) == 1

    monkeypatch.setattr(fb_groups, "_run_local", lambda g: '{"posts": [], "errors": [{"error": "Pages can\'t"}]}')
    with pytest.raises(RuntimeError):
        fb_groups.fetch(cfg)


def test_partial_failure_is_reported_not_swallowed(monkeypatch, capsys):
    """Половина групп не ответила — объявления отдаём, но в stderr пишем об этом."""
    from listing_monitor.sources import fb_groups

    payload = ('{"posts": [{"text": "CHO THUÊ NHÀ NGUYÊN CĂN 2 PHÒNG NGỦ giá 8 triệu/tháng Phú Quốc", '
               '"url": "https://www.facebook.com/photo/?fbid=1"}], '
               '"errors": [{"group": "g2", "query": "q", "error": "TimeoutError: 45000ms exceeded"}]}')
    monkeypatch.setattr(fb_groups, "_run_local", lambda g: payload)
    cfg = SimpleNamespace(offer="rent", fb_groups={"groups": ["g1", "g2"], "queries": ["q"]})

    assert len(fb_groups.fetch(cfg)) == 1
    assert "1 из 2 пар не ответили" in capsys.readouterr().err
