from datetime import datetime, timezone

from listing_monitor.sources import chotot, facebook, muaban, telegram


def test_chotot_parse_keeps_only_rent_ads(fixture_json):
    items = chotot.parse(fixture_json("chotot_listing.json"))
    urls = {i.url for i in items}
    assert "https://www.chotot.com/133763624.htm" in urls
    assert all(i.kind == "rent" for i in items)          # продажа (type 's') отброшена
    house = next(i for i in items if i.url.endswith("133763624.htm"))
    assert house.price_vnd == 5_800_000
    assert house.bedrooms == 2
    assert house.lat and house.lng
    assert house.posted.tzinfo is not None


def test_facebook_parse_search(fixture_json):
    items = facebook.parse_search(fixture_json("facebook_search.json"))
    assert len(items) == 5
    one = next(i for i in items if i.url.endswith("/1435168878041526/"))
    assert one.price_vnd == 13_500_000
    assert one.bedrooms == 1                             # «1 phòng ngủ» из заголовка
    assert all("\n" not in i.title for i in items)
    villa = next(i for i in items if "Villa" in i.title)
    assert villa.price_vnd == 2_000_000                  # «₫2,000» = в тысячах; правдоподобие — дело min_price_vnd


def test_facebook_detail_enriches(fixture_json):
    base = facebook.parse_search({"listings": [{
        "item_id": "27331415733211930", "title": "Cho thuê nhà 5.5tr hẻm 110 đường 30/4",
        "price": "₫5,500", "url": "https://www.facebook.com/marketplace/item/27331415733211930/"}]})[0]
    full = facebook.apply_detail(base, fixture_json("facebook_detail.json"))
    assert full.price_vnd == 5_500_000                   # из заголовка «5.5tr»
    assert full.bedrooms == 2
    assert full.contact == "Seller Name"


def test_muaban_parse(fixture_json):
    items = muaban.parse(fixture_json("muaban_cards.json"))
    villa = next(i for i in items if i.url.endswith("id71224132"))
    assert villa.price_vnd == 60_000_000
    assert villa.bedrooms == 5
    assert "Phú Quốc" in villa.text


def test_telegram_parse(fixture_json):
    items = telegram.parse(fixture_json("telegram_messages.json"))
    by_url = {i.url: i for i in items}
    assert "https://t.me/fukuok7/10051" in by_url
    msg = by_url["https://t.me/fukuok7/10051"]
    assert msg.price_vnd == 14_000_000 and msg.bedrooms == 2
    assert msg.contact == "@seller1"
    assert msg.posted == datetime(2026, 8, 28, 10, tzinfo=timezone.utc)
    assert all(i.url for i in items)                     # без username чата ссылки нет — сообщение пропущено
