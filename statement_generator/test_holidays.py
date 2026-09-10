"""Offline holiday, persistence, and HTTP regression checks using temporary state."""

from contextlib import ExitStack
from dataclasses import asdict
from datetime import date
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import app as web
from . import selftest
from .generator import generate_statement, recalculate_edited_statement, validate_transaction_dates
from .holidays import manual_holiday_dates
from .utils import is_business_day, next_business_day


class HolidayTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(TemporaryDirectory()))
        self.stack.enter_context(patch.object(web, "STATE_FILE", self.root / "state.json"))
        self.stack.enter_context(patch.object(web, "USER_STATE_ROOT", self.root / "users"))
        self.auth = Mock()
        self.auth.verify_user_password.side_effect = lambda _user_id, password: password == "test-password"
        self.auth.list_users.return_value = [{"id": 7}, {"id": 8}]
        self.stack.enter_context(patch.object(web, "AUTH_STORE", self.auth))
        self.user = SimpleNamespace(id=7, username="holiday-test", is_admin=False)

    def action(self, action, **kwargs):
        return web.apply_rule_action({"action": action, "password": "test-password", **kwargs}, self.user)

    def config(self):
        config = selftest.GeneratorTests().build_config()
        config.start_date = date(2026, 1, 1)
        config.end_date = date(2026, 12, 31)
        config.holiday_dates = {date.fromisoformat(value) for value in manual_holiday_dates()}
        return config

    def test_seed_migration_preserves_existing_dates_and_manual_deletions(self):
        web.STATE_FILE.write_text(json.dumps({"schema_version": 5, "custom_holidays": ["2028-01-03"],
                                             "excluded_saturdays": ["2026-09-12"]}), encoding="utf-8")
        rules = web.load_persistent_rules(self.user.id)
        self.assertEqual(len(manual_holiday_dates()), 243)
        self.assertTrue(manual_holiday_dates() <= rules["custom_holidays"])
        self.assertIn("2023-08-26", rules["custom_holidays"])
        self.assertIn("2028-01-03", rules["custom_holidays"])
        self.assertEqual(rules["excluded_saturdays"], set())
        self.action("delete", date="2025-10-23")
        self.assertNotIn("2025-10-23", web.load_persistent_rules(self.user.id)["custom_holidays"])
        self.action("update", original_date="2028-01-03", date="2028-01-04")
        rules = web.load_persistent_rules(self.user.id)
        self.assertIn("2028-01-04", rules["custom_holidays"])
        self.assertNotIn("2028-01-03", rules["custom_holidays"])
        self.assertNotIn("2028-01-04", web.load_persistent_rules(8)["custom_holidays"])

    def test_admin_reset_restores_supplied_baseline(self):
        self.action("add", date="2028-01-03")
        self.action("delete", date="2025-10-23")
        admin = SimpleNamespace(id=1, username="test-admin", is_admin=True)
        web.restore_user_date_rules({"password": "test-password", "user_id": 7, "part": "holidays"}, admin)
        self.assertEqual(web.load_persistent_rules(7)["custom_holidays"], set(manual_holiday_dates()))

    def test_recurring_dates_cannot_be_disguised_as_manual_holidays(self):
        for day, kind in [("2026-09-12", "Saturday"), ("2026-09-13", "Sunday"),
                          ("2026-09-12", "Holiday"), ("2026-09-13", "Holiday")]:
            with self.subTest(day=day, kind=kind):
                for action in ["delete", "add"]:
                    with self.assertRaises(ValueError):
                        self.action(action, date=day, type=kind)
        rows = web.build_holiday_payload("2026-09-01", "2026-09-30", user_id=7)["rows"]
        self.assertEqual(len(rows), len({row["date"] for row in rows}))
        for row in rows:
            if row["type"] == "Holiday":
                day = date.fromisoformat(row["date"])
                self.assertNotEqual(day.weekday(), 5)
                self.assertFalse(day >= date(2026, 4, 5) and day.weekday() == 6)

    def test_password_and_invalid_dates_are_rejected(self):
        before = web.load_persistent_rules(7)["custom_holidays"]
        with self.assertRaises(PermissionError):
            web.apply_rule_action({"action": "add", "date": "2028-01-03", "password": "wrong"}, self.user)
        with self.assertRaises(ValueError):
            self.action("add", date="2026-02-30")
        self.assertEqual(web.load_persistent_rules(7)["custom_holidays"], before)

    def test_weekend_boundaries_and_earlier_manual_sunday(self):
        holidays = {date.fromisoformat(value) for value in manual_holiday_dates()}
        for day in [date(2030, 1, 5), date(2030, 1, 6), date(2026, 4, 5)]:
            self.assertFalse(is_business_day(day, set()))
        self.assertTrue(is_business_day(date(2024, 8, 11), holidays))
        self.assertFalse(is_business_day(date(2024, 8, 4), holidays))
        self.assertEqual(next_business_day(date(2026, 4, 3), set()), date(2026, 4, 6))

    def test_posting_refresh_only_downloads_calendar_and_retains_manual_changes(self):
        before = web.load_persistent_rules(7)["custom_holidays"]
        urls = []

        def page(url, timeout):
            urls.append(url)
            if len(urls) == 1:
                self.action("add", date="2028-01-03")
                self.action("delete", date="2025-10-23")
            return "2035 January 1"

        with patch.object(web, "_download_hamropatro_page", side_effect=page):
            web.refresh_from_internet("2026-01-01", "2026-12-31", user_id=7)
        self.assertTrue(urls)
        self.assertTrue(all(url.startswith(web.HAMROPATRO_ENGLISH_CALENDAR_URL) for url in urls))
        self.assertEqual(web.load_persistent_rules(7)["custom_holidays"], (before | {"2028-01-03"}) - {"2025-10-23"})

    def test_generated_transactions_skip_all_blocked_dates(self):
        config = self.config()
        result = generate_statement(config)
        self.assertTrue(result.events)
        self.assertTrue(all(is_business_day(event.date, config.holiday_dates) for event in result.events))
        self.assertEqual(validate_transaction_dates(config, [asdict(row) for row in result.rows]), [])

    def test_validation_recalculation_and_raw_export_guards(self):
        config = self.config()
        rows = [asdict(row) for row in generate_statement(config).rows]
        index = next(i for i, row in enumerate(rows) if row["category"] == "deposit")
        for day in ["2026-09-08", "2026-09-12", "2026-09-13"]:
            changed = [dict(row) for row in rows]
            changed[index]["date"] = day
            self.assertTrue(validate_transaction_dates(config, changed))
            with self.assertRaises(ValueError):
                web.hydrate_result_payload(config, {"rows": changed})
            repaired = recalculate_edited_statement(config, changed)
            self.assertEqual(validate_transaction_dates(config, [asdict(row) for row in repaired.rows]), [])
        for field in ["txn_date", "value_date"]:
            changed = [dict(row) for row in rows]
            changed[index][field] = "2026-09-12"
            errors = validate_transaction_dates(config, changed)
            self.assertTrue(any(field in error["fields"] for error in errors))

    def test_forged_system_category_cannot_reopen_unconfigured_holiday(self):
        config = self.config()
        for category in ["deposit", "interest", "tax"]:
            self.assertTrue(validate_transaction_dates(config, [{"date": "2026-09-12", "category": category,
                                                                "description": "Cash Deposit", "credit": 100}]))

    def test_desktop_manual_rule_methods_protect_weekends(self):
        from .app import StatementGeneratorApp
        desktop = SimpleNamespace(custom_holiday_dates=set(manual_holiday_dates()))
        desktop._validate_rule_date = lambda day, kind: StatementGeneratorApp._validate_rule_date(desktop, day, kind)
        for day in ["2026-09-12", "2026-09-13"]:
            with self.assertRaises(ValueError):
                StatementGeneratorApp._apply_rule(desktop, day, "Holiday")
            with self.assertRaises(ValueError):
                StatementGeneratorApp._remove_rule(desktop, "holiday:" + day)
        StatementGeneratorApp._apply_rule(desktop, "2028-01-03", "Holiday")
        self.assertIn("2028-01-03", desktop.custom_holiday_dates)

    def test_http_manual_holidays_retired_sync_and_date_only_validation(self):
        current_user = self.user

        class Handler(web.StatementWebHandler):
            def _require_statement_user(self):
                return current_user

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            def post(route, body):
                connection = HTTPConnection(*server.server_address, timeout=5)
                try:
                    connection.request("POST", route, json.dumps(body), {"Content-Type": "application/json"})
                    response = connection.getresponse()
                    return response.status, json.loads(response.read())
                finally:
                    connection.close()

            status, body = post("/api/holidays", {"action": "add", "date": "2028-01-03", "password": "test-password"})
            self.assertEqual(status, 200)
            self.assertTrue(any(row["date"] == "2028-01-03" for row in body["rows"]))
            with patch.object(web.urllib.request, "urlopen", side_effect=AssertionError("Unexpected network request")):
                status, body = post("/api/holidays_sync", {})
                self.assertEqual(status, 410)
            status, body = post("/api/validate_statement", {"config": web.default_form_values(), "dates_only": True,
                                "edited_rows": [{"date": "2026-09-12", "credit": 100, "category": "deposit"}]})
            self.assertEqual(status, 200)
            self.assertFalse(body["ok"])
            self.assertIn("date", body["errors"][0]["fields"])
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
