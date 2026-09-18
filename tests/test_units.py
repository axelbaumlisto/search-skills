#!/usr/bin/env python3
"""Unit tests for the pure parts: no network, no session, no browser."""
import json
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
