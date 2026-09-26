import pytest

from rental_monitor.parse import is_rent_offer, parse_bedrooms, parse_price_vnd


@pytest.mark.parametrize("text, expected", [
    ("Cho thuê nhà 5.5tr hẻm 110", 5_500_000),
    ("giá 5,8 triệu/tháng", 5_800_000),
    ("12 triệu/tháng", 12_000_000),
    ("₫7,500,000", 7_500_000),
    ("Цена 14М", 14_000_000),
    ("Арендная плата составляет 15 миллионов VND в месяц", 15_000_000),
    ("18 млн, контракт от года", 18_000_000),
    ("$800 в месяц", 800 * 25_500),
    ("2,6 tỷ", 2_600_000_000),
    ("без цены, пишите", None),
    ("3 phòng ngủ 120 m2", None),
])
def test_parse_price_vnd(text, expected):
    assert parse_price_vnd(text) == expected


@pytest.mark.parametrize("text, expected", [
    ("Nhà gồm 2 phòng ngủ 2 phòng khách", 2),
    ("90 m² · 3 PN", 3),
    ("nhà 2pn, máy lạnh", 2),
    ("2 спальни (1 мастер бедрум)", 2),
    ("В нем две спальни с двумя кондиционерами", 2),
    ("Новый дом, три спальни", 3),
    ("Villa 5 Phòng Ngủ", 5),
    ("2BR apartment", 2),
    ("2 bedrooms house", 2),
    ("студия у моря", None),
])
def test_parse_bedrooms(text, expected):
    assert parse_bedrooms(text) == expected


@pytest.mark.parametrize("text, expected", [
    ("Сдаётся частный дом после ремонта", True),
    ("Сдам дом, 2 спальни", True),
    ("#фукуок Дом новый. Арендная плата 15 миллионов", True),
    ("Cho thuê nhà nguyên căn", True),
    ("кто сдает квартиру на фукуок ?", False),
    ("Ищем дом на долгий срок", False),
    ("Cần thuê nhà 2 phòng ngủ", False),
    ("АРЕНДА БАЙКОВ, скутеры", False),
])
def test_is_rent_offer(text, expected):
    assert is_rent_offer(text) is expected
