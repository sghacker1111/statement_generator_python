from dataclasses import asdict, replace
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, ROUND_UP
from pathlib import Path
from tempfile import TemporaryDirectory
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
                       tax_rate=7, holiday_dates=set(), include_cheque_column=False)

    def test_daily_round_up_before_multiplying_days(self):
        self.assertEqual(_segment_interest(1000, 10, 3, 4), 0.822)
        self.assertEqual(_segment_interest(1000, 10, 3, 2), 0.84)
        self.assertEqual(_segment_interest(1500000, 8, 1, 4), 328.7672)
        self.assertEqual(_segment_interest(1500000, 8, 1, 2), 328.77)
        for places in (2, 4):
            self.assertEqual(_segment_interest(3650, 12.3, 10, places), 12.3)
            self.assertEqual(_segment_interest(365000, 10, 93, places), 9300)
            self.assertEqual(_segment_interest(0, 10, 93, places), 0)
            self.assertEqual(_segment_interest(1000, 0, 93, places), 0)
            self.assertEqual(_segment_interest(1, 0.000001, 1, places), 10 ** -places)
            self.assertEqual(_segment_interest(3650, 12.300000001, 1, places), 1.24 if places == 2 else 1.2301)

    def test_checks_recalculation_and_tax_use_selected_precision(self):
        for places, interest, tax in ((4, 25.76, 1.80), (2, 26.32, 1.84)):
            config = self.config(places)
            result = recalculate_edited_statement(config, [])
            self.assertEqual(result.summary.total_interest, interest)
            self.assertEqual(result.summary.total_tax, tax)  # Half Up, not Round Up.
            rows = [asdict(row) for row in result.rows]
            for imported in (False, True):
                self.assertEqual(validate_edited_statement(config, rows, imported), [])
                wrong = replace(config, interest_rounding_places=6 - places)
                errors = validate_edited_statement(wrong, rows, imported)
                self.assertTrue(any("credit" in error["fields"] for error in errors))
            self.assertEqual(result.final_balance, round(1000 + interest - tax, 2))

    def test_generated_interest_matches_daily_decimal_oracle(self):
        for places in (2, 4):
            config = selftest.GeneratorTests().build_config()
            config.interest_rounding_places = places
            result = generate_statement(config)
            balance, accrued = Decimal(str(config.opening_balance)), Decimal(0)
            previous = date(2024, 7, 16)
            for row in result.rows:
                day_interest = (balance * Decimal(str(config.interest_rate)) / Decimal(36500)).quantize(
                    Decimal(1).scaleb(-places), rounding=ROUND_UP)
                accrued += day_interest * (row.date - previous).days
                previous = row.date
                if row.category == "interest":
                    self.assertEqual(row.credit, float(accrued.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)))
                    accrued = Decimal(0)
                balance = Decimal(str(row.balance))
            self.assertEqual(validate_edited_statement(config, [asdict(row) for row in result.rows]), [])

    def test_config_defaults_profiles_and_invalid_values(self):
        import app as web
        with TemporaryDirectory() as root, patch.object(web, "STATE_FILE", Path(root) / "state.json"):
            form = web.default_form_values()
            self.assertEqual(form["interest_rounding_places"], "4")
            self.assertIn("interest_rounding_places", web.profile_field_keys())
            del form["interest_rounding_places"]
            self.assertEqual(web.build_config(form).interest_rounding_places, 4)
            for value in (2, 4, "2", "4"):
                self.assertEqual(web.build_config({**form, "interest_rounding_places": value}).interest_rounding_places, int(value))
            for value in (0, 3, 5, "2.5", "invalid", True):
                with self.assertRaisesRegex(ValueError, "2 or 4"):
                    web.build_config({**form, "interest_rounding_places": value})
            for value in (None, ""):
                self.assertEqual(interest_rounding_places(value), 4)
            auth = Mock()
            auth.load_profile.return_value = {"profile": {"interest_rounding_places": "2"}}
            with patch.object(web, "AUTH_STORE", auth):
                self.assertEqual(web.bootstrap_defaults(SimpleNamespace(id=7))["interest_rounding_places"], "2")

    def test_desktop_profile_restores_precision_and_legacy_default(self):
        from .app import StatementGeneratorApp
        from .holidays import MANUAL_HOLIDAY_SEED_VERSION
        var = Mock()
        desktop = SimpleNamespace(vars={"interest_rounding_places": var}, deposit_names_text=Mock(),
                                  withdrawal_names_text=Mock(), default_holiday_dates=set(), holiday_view_var=Mock(),
                                  _save_persistent_rules=Mock(), refresh_holiday_display=Mock())
        for values, expected in (({"interest_rounding_places": "2"}, "2"), ({}, "4")):
            StatementGeneratorApp._apply_profile_payload(desktop, {"vars": values, "holiday_seed_version": MANUAL_HOLIDAY_SEED_VERSION})
            self.assertEqual(var.set.call_args.args[0], expected)


if __name__ == "__main__":
    unittest.main()
