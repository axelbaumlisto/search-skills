#!/usr/bin/env python3
"""Unit tests for the pure parts: no network, no session, no browser."""
import importlib.util
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills" / "fb-marketplace" / "scripts"))

import fb_local as g  # noqa: E402   # модуль переименован из fb_graphql

# Проверяемые функции приходят из fb_marketplace.py, который ставится отдельно.
# Без него тесты чистых функций проверять нечего — пропускаем, а не падаем.
HAVE_QUERY_LAYER = bool(getattr(g, "CITY_COORDS", None))


@unittest.skipUnless(HAVE_QUERY_LAYER, "fb_marketplace.py не установлен")
class MergeVariables(unittest.TestCase):
    def base(self):
        return {"count": 24, "cursor": "stale-page-7",
                "params": {"bqf": {"query": "old"},
                           "browse_request_params": {"filter_price_lower_bound": 0}}}

    def test_injects_query_and_geo(self):
        out = g.merge_variables(self.base(), query="giày", lat=16.05, lng=108.2,
                                radius_km=25, min_price=None, max_price=None,
                                days=None, shipping=False)
        bp = out["params"]["browse_request_params"]
        self.assertEqual(out["params"]["bqf"]["query"], "giày")
        self.assertEqual((bp["filter_location_latitude"], bp["filter_location_longitude"]), (16.05, 108.2))
        self.assertEqual(bp["filter_radius_km"], 25)

    def test_drops_stale_cursor(self):
        """A captured template carries a pagination cursor; replaying it returns page 7."""
        out = g.merge_variables(self.base(), query="x", lat=0, lng=0, radius_km=1,
                                min_price=None, max_price=None, days=None, shipping=False)
        self.assertNotIn("cursor", out)

    def test_keeps_template_price_bounds_when_not_asked(self):
        """FB degrades the response when price bounds are nulled out."""
        out = g.merge_variables(self.base(), query="x", lat=0, lng=0, radius_km=1,
                                min_price=None, max_price=None, days=None, shipping=False)
        self.assertEqual(out["params"]["browse_request_params"]["filter_price_lower_bound"], 0)

    def test_accepts_wrapped_variables(self):
        out = g.merge_variables({"variables": self.base()}, query="q", lat=1, lng=2,
                                radius_km=3, min_price=10, max_price=20, days=7, shipping=True)
        bp = out["variables"]["params"]["browse_request_params"]
        self.assertEqual((bp["filter_price_lower_bound"], bp["filter_price_upper_bound"]), (10, 20))
        self.assertEqual(bp["commerce_search_and_rp_ctime_days"], 7)
        self.assertTrue(bp["commerce_enable_shipping"])


@unittest.skipUnless(HAVE_QUERY_LAYER, "fb_marketplace.py не установлен")
class ParseEdges(unittest.TestCase):
    def payload(self, listing):
        return {"data": {"marketplace_search": {"feed_units": {"edges": [{"node": {"listing": listing}}]}}}}

    def test_parses_a_listing(self):
        out = g.parse_edges(self.payload({
            "id": "123", "marketplace_listing_title": "iPhone 15",
            "listing_price": {"formatted_amount": "₫14,500"},
            "location": {"reverse_geocode": {"city_page": {"display_name": "Da Nang, Vietnam"},
                                             "latitude": 16.05, "longitude": 108.2}}}))
        self.assertEqual(out[0]["item_id"], "123")
        self.assertEqual(out[0]["location"], "Da Nang, Vietnam")
        self.assertEqual(out[0]["url"], "https://www.facebook.com/marketplace/item/123/")
        self.assertEqual((out[0]["lat"], out[0]["lng"]), (16.05, 108.2))

    def test_skips_malformed_edges(self):
        self.assertEqual(g.parse_edges(self.payload({"id": "1"})), [])          # no title
        self.assertEqual(g.parse_edges({"data": {}}), [])                        # no feed
        self.assertEqual(g.parse_edges({"data": {"marketplace_search": {"feed_units": {"edges": "x"}}}}), [])

    def test_missing_price_is_none_not_crash(self):
        out = g.parse_edges(self.payload({"id": "9", "marketplace_listing_title": "Free bike"}))
        self.assertIsNone(out[0]["price"])


class NodeParsers(unittest.TestCase):
    def node(self, source: str, env=None):
        p = subprocess.run(["node", "-e", source], cwd=ROOT, env={**os.environ, **(env or {})},
                           capture_output=True, text=True, check=True)
        return json.loads(p.stdout)

    def test_shopee_vitem_resolves_real_product(self):
        out = self.node(r'''const {parseItem}=require('./skills/shopee/scripts/lib.cjs');
          console.log(JSON.stringify(parseItem({
            item_identities:['vitem'], shopid:1506174776, itemid:56217701339,
            real_items:[{shop_id:400502712,item_id:8057038868}],
            item_data:{item_card_display_price:{price:12300000}},
            item_card_displayed_asset:{name:'real chair',image:'abc'}
          })));''', {"SHOPEE_REGION": "vn"})
        self.assertEqual(out["url"], "https://shopee.vn/product/400502712/8057038868")
        self.assertEqual(out["price_vnd"], 123)
        self.assertTrue(out["vitem"])

    def test_lazada_prices_and_portable_bridge(self):
        out = self.node(r'''const x=require('./skills/lazada/scripts/lazada.cjs');
          console.log(JSON.stringify({
            card:x.parseCard({text:'Ghế kem ~ 184.536 ₫ ~ 12 đã bán ~ (9) ~ Đà Nẵng',url:'u'}),
            portable:x.BRIDGE===x.LOCAL_BRIDGE,
            product:x.productUrl('abc-i123456789.html')
          }));''', {"LAZADA_REGION": "vn"})
        self.assertEqual(out["card"]["price"], 184536)
        self.assertEqual(out["card"]["sold"], 12)
        self.assertTrue(out["portable"])
        self.assertIn("lazada.vn", out["product"])


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class PortableSkills(unittest.TestCase):
    def test_homepro_structured_parser(self):
        hp = load_module("hp_skill", ROOT / "skills/_thai_shared/hp.py")
        body = json.dumps({"items": [{
            "partnumber": "1234567", "item_name": "สินค้า", "item_name_en": "PRODUCT",
            "price_display": '<span class="normal-price">3,100</span><span class="reduced-price"><span>1,790</span></span>',
            "brand": "ACME",
        }]})
        row = hp.parse_suggest(body)[0]
        self.assertEqual((row["price"], row["original_price"]), (1790, 3100))
        self.assertEqual(row["url"], "https://www.homepro.co.th/p/1234567")

    def test_vietqr_pure_functions(self):
        vq = load_module("vietqr_skill", ROOT / "skills/vietqr/scripts/vietqr.py")
        self.assertEqual(vq.deaccent("Thanh toán Đà Nẵng"), "Thanh toan Da Nang")
        self.assertEqual(vq.resolve_bank("bidv"), "970418")
        url = vq.build("970418", "0123456789", "1,500,000", "TT hóa đơn", "Công ty", "compact2")
        self.assertIn("amount=1500000", url)
        self.assertNotIn("ó", url)

    def test_gmail_defaults_to_xdg_and_has_no_send_scope(self):
        p = (ROOT / "skills/gmail/scripts/gmail.py").read_text()
        self.assertIn('".config" / "pi-skills" / "gmail"', p)
        self.assertNotIn("messages().send", p)
        self.assertNotIn("messages.send", p)
        self.assertNotIn('add_parser("send")', p)
        self.assertNotIn(".adloop", p)

    def test_vietqr_examples_are_generic(self):
        for f in (ROOT / "skills/vietqr/SKILL.md", ROOT / "skills/vietqr/scripts/vietqr.py"):
            p = f.read_text()
            self.assertNotIn("SO" + "VA", p)
            self.assertNotIn("0402" + "348439", p)
            self.assertIn("ACME", p)

    def test_places_runtime_is_discovered_not_hardcoded(self):
        p = (ROOT / "skills/google-places/scripts/places.sh").read_text()
        self.assertIn("PLACES_HOME", p)
        self.assertIn('work/*/*', p)
        self.assertNotIn("tg" + "_agent", p)


class RuntimeWrappers(unittest.TestCase):
    def test_telegram_wrapper_no_longer_defaults_to_empty_config(self):
        text = (ROOT / "skills/telegram-search/scripts/tg-search.sh").read_text()
        self.assertIn('work/*/*', text)
        self.assertIn('set TG_HOME', text)

    def test_bridge_failure_is_exception_not_success_string(self):
        text = (ROOT / "skills/shopee/scripts/chrome_tab.cjs").read_text()
        self.assertIn('throw new Error(`bridge: could not open', text)
        self.assertNotIn("return 'could not open a bridge window'", text)


class Cities(unittest.TestCase):
    def test_every_city_has_sane_coordinates(self):
        for city, (lat, lng) in g.CITY_COORDS.items():
            self.assertTrue(-90 <= lat <= 90 and -180 <= lng <= 180, city)

    def test_examples_match_the_documented_shape(self):
        """The README points strangers at examples/ — keep them parseable and honest."""
        fb = json.loads((ROOT / "examples" / "fb-search.json").read_text())
        self.assertEqual(fb["backend"], "graphql-local")
        self.assertEqual(len(fb["listings"]), fb["count"])
        tg = json.loads((ROOT / "examples" / "telegram-search.json").read_text())
        self.assertTrue(tg["success"] and tg["dialogs_scanned"] >= 200)


if __name__ == "__main__":
    unittest.main(verbosity=2)
