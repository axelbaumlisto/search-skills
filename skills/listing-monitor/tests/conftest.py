import json
from pathlib import Path

import pytest

from listing_monitor.config import load_config

FIX = Path(__file__).parent / "fixtures"
CFG_TOML = """
name = "test"
max_price_vnd = 20_000_000
min_bedrooms = 2
exclude_keywords = ["nha trang", "нячанг", "đà nẵng", "дананг", "hội an", "hồ chí minh", "sài gòn", "hà nội"]
city_keywords = ["фукуок", "phú quốc", "phu quoc", "dương đông", "duong dong", "ong lang", "ông lang"]

[center]
label = "KingKong Mart"
lat = 10.19538
lng = 103.96795

[districts]   # подстрока в тексте = [lat, lng] центра района (приблизительно)
"ночного рынка" = [10.2166, 103.9587]
"chợ đêm" = [10.2166, 103.9587]
"dinh cậu" = [10.2177, 103.9565]
"30/4" = [10.217, 103.963]
"dương đông" = [10.2156, 103.9609]
"duong dong" = [10.2156, 103.9609]
"дуонг донг" = [10.2156, 103.9609]
"cây thông" = [10.231, 104.001]
"suối đá" = [10.24, 103.978]
"ông lang" = [10.267, 103.947]
"ong lang" = [10.267, 103.947]
"онг ланг" = [10.267, 103.947]
"cửa lấp" = [10.165, 103.98]
"dương tơ" = [10.156, 103.989]
"suối mây" = [10.176, 103.996]
"búng gội" = [10.28, 103.956]
"đường bào" = [10.206, 104.01]
"cửa cạn" = [10.315, 103.942]
"meyhomes" = [10.111, 103.979]
"мейхоумс" = [10.111, 103.979]
"grand world" = [10.335, 103.856]
"an thới" = [10.02, 104.012]
"an thoi" = [10.02, 104.012]
"антхой" = [10.02, 104.012]
"hàm ninh" = [10.183, 104.05]
"gành dầu" = [10.37, 103.859]
"sân bay" = [10.17, 103.993]

[chotot]
area_v2 = 503112
categories = [1000]

[facebook]
queries = ["cho thuê nhà"]
lat = 10.1954
lng = 103.968
radius_km = 25
limit = 30
max_details = 3
remote_host = "browser-host"
remote_script = "/remote/fb_marketplace.py"

[telegram]
session = "/tmp/search_session"
queries = ["Фукуок аренда"]

[muaban]
urls = ["https://muaban.net/bat-dong-san/cho-thue-nha-dat-kien-giang"]
remote_host = "browser-host"

[notify]
session = "/tmp/notify_session"
peer_id = 123456789

[paths]
state = "state.json"
master = "master.md"
"""


@pytest.fixture
def cfg(tmp_path):
    p = tmp_path / "c.toml"
    p.write_text(CFG_TOML)
    return load_config(p)


@pytest.fixture
def fixture_json():
    return lambda name: json.loads((FIX / name).read_text())
