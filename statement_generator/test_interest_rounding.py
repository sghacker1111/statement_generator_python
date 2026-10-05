from dataclasses import asdict, replace
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from . import selftest
from .generator import _segment_interest, generate_statement, recalculate_edited_statement, validate_edited_statement
from .utils import interest_rounding_places


class InterestRoundingTests(unittest.TestCase):
    def config(self, places):
        return replace(selftest.GeneratorTests().build_config(), interest_rounding_places=places,
                       start_date=date(2025, 4, 18), end_date=date(2025, 7, 20),
                       opening_balance=1000, target_closing_balance=1000, interest_rate=10,
                       tax_rate=6, holiday_dates=set(), include_cheque_column=False)

    def test_daily_half_up_rounds_before_multiplying_days(self):
        # 1000 * 10 / 36500 = 0.273972... => 0.27 per day, not 0.28.
        self.assertEqual(_segment_interest(1000, 10, 3), 0.81)
        self.assertEqual(_segment_interest(1500000, 8, 1), 328.77)
        for places in (2, 4):  # Historical four-place configurations use two places.
            self.assertEqual(_segment_interest(1000, 10, 3, places), 0.81)
            self.assertEqual(_segment_interest(3650, 12.3, 10, places), 12.3)
            self.assertEqual(_segment_interest(365000, 10, 93, places), 9300)
            self.assertEqual(_segment_interest(0, 10, 93, places), 0)
            self.assertEqual(_segment_interest(1000, 0, 93, places), 0)
            self.assertEqual(_segment_interest(1, 0.000001, 1, places), 0)

    def test_daily_decimal_ties_and_below_five(self):
        # With balance 3650, the raw daily value is the annual rate / 10.
        for rate, expected in (("12.3499999999999999999999", 1.23),
                               ("12.35", 1.24), ("12.36", 1.24),
                               ("12.300000001", 1.23), ("19.95", 2.00)):
            with self.subTest(rate=rate):
                self.assertEqual(_segment_interest(3650, Decimal(rate), 1), expected)
        self.assertEqual(_segment_interest(3650, 12.35, 3), 3.72)

    def test_checks_recalculation_and_tax_use_fixed_half_up(self):
        for places in (2, 4):
            config = self.config(places)
            result = recalculate_edited_statement(config, [])
            # April 13 to July 16 is 94 days: 0.27 * 94 = 25.38.
            self.assertEqual(result.summary.total_interest, 25.38)
            self.assertEqual(result.summary.total_tax, 1.52)  # 25.38 * 6% = 1.5228.
            rows = [asdict(row) for row in result.rows]
            for imported in (False, True):
                self.assertEqual(validate_edited_statement(config, rows, imported), [])
            self.assertEqual(result.final_balance, 1023.86)

    def test_imported_check_accepts_half_up_and_rejects_round_up_interest(self):
        for places in (2, 4):
            config = self.config(places)
            rows = [
                dict(date="2025-04-18", description="Opening Balance", debit=0, credit=0,
                     balance=1000, category="opening"),
                dict(date="2025-07-16", description="Interest", debit=0, credit=25.38,
                     balance=1025.38, category="interest"),
                dict(date="2025-07-16", description="Tax", debit=1.52, credit=0,
                     balance=1023.86, category="tax"),
                dict(date="2025-07-18", description="Balance C/F", debit=0, credit=0,
                     balance=1023.86, category="closing"),
            ]
            self.assertEqual(validate_edited_statement(config, rows, imported_check=True), [])
            rows[1]["credit"] = 26.32  # The retired ROUND_UP daily result.
            errors = validate_edited_statement(config, rows, imported_check=True)
            self.assertTrue(any(error["row_index"] == 1 and "credit" in error["fields"] for error in errors))

    def test_generated_interest_matches_daily_decimal_oracle(self):
        for places in (2, 4):
            config = selftest.GeneratorTests().build_config()
            config.interest_rounding_places = places
            result = generate_statement(config)
            balance, accrued = Decimal(str(config.opening_balance)), Decimal(0)
            previous = date(2024, 7, 16)
            for row in result.rows:
                day_interest = (balance * Decimal(str(config.interest_rate)) / Decimal(36500)).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP)
                accrued += day_interest * (row.date - previous).days
                previous = row.date
                if row.category == "interest":
                    self.assertEqual(row.credit, float(accrued.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)))
                    accrued = Decimal(0)
                balance = Decimal(str(row.balance))
            self.assertEqual(validate_edited_statement(config, [asdict(row) for row in result.rows]), [])

    def test_http_recalculation_preserves_imported_opening_posting_exception(self):
        import app as web

        class Handler(web.StatementWebHandler):
            def _require_statement_user(self):
                return SimpleNamespace(id=7, username="rounding-test")

            def log_message(self, *_args):
                pass

        config = replace(self.config(2), start_date=date(2024, 7, 16), end_date=date(2024, 7, 18))
        rows = [dict(date="2024-07-16", description="Balance B/F", debit=0, credit=1000,
                     balance=1000, category="opening"),
                dict(date="2024-07-18", description="Balance C/F", debit=0, credit=0,
                     balance=1000, category="closing")]
        auth = Mock()
        auth.save_statement.return_value = {"statement_id": 1}
        auth.require_user.return_value.as_payload.return_value = {"id": 7}
        auth.statement_history.return_value = []
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(web, "build_config", return_value=config), patch.object(web, "AUTH_STORE", auth), \
                    patch.object(web, "build_holiday_payload", return_value={}):
                for source in ("imported", "generated"):
                    with self.subTest(source=source):
                        connection = HTTPConnection(*server.server_address, timeout=5)
                        try:
                            connection.request("POST", "/api/recalculate_statement", json.dumps({
                                "config": {}, "edited_rows": rows, "source_type": source,
                            }), {"Content-Type": "application/json"})
                            response = connection.getresponse()
                            body = json.loads(response.read())
                            self.assertEqual(response.status, 200, body)
                            interest_rows = [row for row in body["rows"] if row["category"] == "interest"]
                            if source == "imported":
                                self.assertEqual(interest_rows, [])
                                self.assertEqual(body["final_balance"], 1000)
                            else:
                                self.assertEqual(interest_rows[0]["credit"], 25.38)
                            self.assertEqual(body["source_type"], source)
                        finally:
                            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    def test_config_defaults_profiles_and_invalid_values(self):
        import app as web
        with TemporaryDirectory() as root, patch.object(web, "STATE_FILE", Path(root) / "state.json"):
            form = web.default_form_values()
            self.assertEqual(form["interest_rounding_places"], "2")
            self.assertIn("interest_rounding_places", web.profile_field_keys())
            del form["interest_rounding_places"]
            self.assertEqual(web.build_config(form).interest_rounding_places, 2)
            for value in (2, 4, "2", "4", None, "", " "):
                self.assertEqual(web.build_config({**form, "interest_rounding_places": value}).interest_rounding_places, 2)
            for value in (0, 3, 5, "2.5", "invalid", True, False, 2.0, [], {}):
                with self.assertRaisesRegex(ValueError, "2 decimal places"):
                    web.build_config({**form, "interest_rounding_places": value})
            for value in (None, ""):
                self.assertEqual(interest_rounding_places(value), 2)
            auth = Mock()
            for values in ({"interest_rounding_places": "2"}, {"interest_rounding_places": "4"}, {}):
                auth.load_profile.return_value = {"profile": values}
                with patch.object(web, "AUTH_STORE", auth):
                    self.assertEqual(web.bootstrap_defaults(SimpleNamespace(id=7))["interest_rounding_places"], "2")
            auth.load_profile.return_value = {"profile": {"interest_rounding_places": "3"}}
            with patch.object(web, "AUTH_STORE", auth), self.assertRaisesRegex(ValueError, "2 decimal places"):
                web.bootstrap_defaults(SimpleNamespace(id=7))

    def test_desktop_profile_restores_precision_and_legacy_default(self):
        from .app import StatementGeneratorApp
        from .holidays import MANUAL_HOLIDAY_SEED_VERSION
        from tkinter import StringVar, Tcl
        var = StringVar(master=Tcl())
        desktop = SimpleNamespace(vars={"interest_rounding_places": var}, deposit_names_text=Mock(),
                                  withdrawal_names_text=Mock(), default_holiday_dates=set(), holiday_view_var=Mock(),
                                  _save_persistent_rules=Mock(), refresh_holiday_display=Mock())
        for values, expected in (({"interest_rounding_places": "2"}, "2"),
                                 ({"interest_rounding_places": "4"}, "2"), ({}, "2")):
            StatementGeneratorApp._apply_profile_payload(desktop, {"vars": values, "holiday_seed_version": MANUAL_HOLIDAY_SEED_VERSION})
            self.assertEqual(var.get(), expected)


if __name__ == "__main__":
    unittest.main()
