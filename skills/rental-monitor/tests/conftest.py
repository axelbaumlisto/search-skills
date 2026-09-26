import json
from pathlib import Path

import pytest

from rental_monitor.config import load_config

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
