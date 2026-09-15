from collections import Counter
from dataclasses import asdict
from datetime import date, timedelta
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import random
from tempfile import TemporaryDirectory
from threading import Thread
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from .generator import _plan_transaction_counts, generate_statement, validate_config
from .rounding import amount_class, parse_percentages
from . import selftest


class RoundingTests(unittest.TestCase):
    def config(self, mode="automatic", percentages=None):
        config = selftest.GeneratorTests().build_config()
        config.amount_rounding_mode = mode
        config.amount_rounding_percentages = percentages or {}
        return config

    def assert_quotas(self, rows, expected):
        counts = Counter(amount_class(int(row.credit or row.debit)) for row in rows if row.category in {"deposit", "withdrawal"})
        total = sum(counts.values())
        for step, percent in expected.items():
            self.assertLess(abs(counts[step] - total * percent / 100), 1.000001)
        self.assertEqual(sum(counts[step] for step, percent in expected.items() if percent == 0), 0)

    def test_all_six_credit_count_differences_are_possible(self):
        months = {(2026, m): [date(2026, m, 1) + timedelta(days=n) for n in range(20)] for m in range(1, 13)}
        gaps = set()
        for seed in range(30):
            for total in (59, 60):
                _, totals, deposits, withdrawals, desired = _plan_transaction_counts(months, 0, total, random.Random(seed))
                self.assertEqual(desired, total)
                self.assertEqual(sum(totals), total)
                self.assertEqual(sum(deposits) + sum(withdrawals), total)
                gap = sum(deposits) - sum(withdrawals)
                self.assertIn(gap, range(5, 11))
                gaps.add(gap)
        self.assertEqual(gaps, set(range(5, 11)))

    def test_custom_monthly_counts_stay_exact_with_random_credit_gap(self):
        config = self.config()
        config.start_date, config.end_date = date(2026, 1, 1), date(2026, 12, 31)
        config.transaction_count_mode = "custom"
        config.monthly_transaction_counts = {(2026, month): 5 for month in range(1, 13)}
        result = generate_statement(config)
        self.assertEqual(Counter((row.date.year, row.date.month) for row in result.rows if row.category in {"deposit", "withdrawal"}), config.monthly_transaction_counts)
        self.assertIn(result.summary.deposit_count - result.summary.withdrawal_count, (6, 8, 10))

    def test_automatic_percentages_hold_after_reconciliation(self):
        for seed in (123456, 123457, 123458):
            config = self.config()
            config.seed = seed
            result = generate_statement(config)
            amounts = [int(row.credit or row.debit) for row in result.rows if row.category in {"deposit", "withdrawal"}]
            counts = Counter("large" if amount % 500 == 0 else "medium" if amount % 50 == 0 else "small" for amount in amounts)
            for group, percentage in [("large", 70), ("medium", 20), ("small", 10)]:
                self.assertLess(abs(counts[group] - len(amounts) * percentage / 100), 1.000001)
            self.assertEqual(len(amounts), len(result.events))
            self.assertTrue(all(amount % 5 == 0 for amount in amounts))
            self.assertIn(result.summary.deposit_count - result.summary.withdrawal_count, range(5, 11))
            self.assertLessEqual(abs(result.final_balance - config.target_closing_balance), 3000)

    def test_custom_percentages_apply_to_both_columns_together(self):
        percentages = {1000: 20, 500: 25, 100: 10, 50: 15, 10: 20, 5: 10}
        config = self.config("custom", percentages)
        result = generate_statement(config)
        self.assert_quotas(result.rows, percentages)
        for row in result.rows:
            if row.category == "deposit":
                self.assertTrue(config.deposit_min_amount <= row.credit <= config.deposit_max_amount)
            elif row.category == "withdrawal":
                self.assertTrue(config.withdrawal_min_amount <= row.debit <= config.withdrawal_max_amount)
        again = generate_statement(config)
        self.assertEqual([asdict(row) for row in result.rows], [asdict(row) for row in again.rows])

    def test_zero_and_full_percentages_keep_exclusive_class(self):
        for step in (1000, 500, 100, 50, 10, 5):
            config = self.config("custom", {step: 100})
            result = generate_statement(config)
            self.assertTrue(all(amount_class(int(event.amount)) == step for event in result.events))

    def test_invalid_percentages_are_rejected(self):
        for values in ({}, [], {1000: 70}, {1000: -1, 500: 101}, {1000: float("nan")},
                       {1000: float("inf")}, {1000: True}, {42: 100}, {1000: ""}, "invalid"):
            with self.subTest(values=values), self.assertRaises(ValueError):
                parse_percentages(values)
        self.assertEqual(parse_percentages('{"1000":33.33,"500":33.33,"5":33.34}')[5], 33.34)
        with self.assertRaises(ValueError):
            validate_config(self.config("custom", {1000: 99}))

    def test_tiny_counts_require_at_least_seven_transactions(self):
        months = {(2026, 1): [date(2026, 1, 1) + timedelta(days=n) for n in range(20)]}
        with self.assertRaisesRegex(ValueError, "At least 7"):
            _plan_transaction_counts(months, 0, 6, random.Random(1))
        for total in (7, 8, 9, 10):
            _, _, deposits, withdrawals, _ = _plan_transaction_counts(months, 0, total, random.Random(1))
            self.assertGreater(sum(withdrawals), 0)
            self.assertIn(sum(deposits) - sum(withdrawals), range(5, 11))

    def test_web_config_preserves_custom_percentage_field(self):
        import app
        with TemporaryDirectory() as temp, patch.object(app, "STATE_FILE", Path(temp) / "state.json"):
            form = app.default_form_values()
            form["amount_rounding_mode"] = "custom"
            form["amount_rounding_percentages"] = '{"1000":60,"500":20,"5":20}'
            config = app.build_config(form)
            self.assertEqual(config.amount_rounding_percentages[1000], 60)
            self.assertIn("amount_rounding_percentages", app.profile_field_keys())
            with self.assertRaises(ValueError):
                app.build_config({**form, "amount_rounding_percentages": '{"1000":99}'})

    def test_generate_http_saves_history_and_rounding_profile(self):
        import app
        from auth_store import AuthStore
        with TemporaryDirectory() as temp:
            root = Path(temp)
            auth = AuthStore(root / 'auth.db')
            user = auth.create_user('rounding-user', 'temporary-test-password', 'user',
                                    full_name='Rounding Test', mobile_number='0000000000')
            other = auth.create_user('rounding-other', 'temporary-test-password', 'user',
                                     full_name='Other Test', mobile_number='0000000000')
            token = auth.login(user.username, 'temporary-test-password')['token']
            class Handler(app.StatementWebHandler):
                def log_message(self, *_args):
                    pass
            with patch.object(app, 'AUTH_STORE', auth), patch.object(app, 'STATE_FILE', root / 'state.json'), patch.object(app, 'USER_STATE_ROOT', root / 'users'):
                server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
                thread = Thread(target=server.serve_forever, daemon=True)
                thread.start()
                def request(route, body=None):
                    connection = HTTPConnection('127.0.0.1', server.server_port, timeout=30)
                    try:
                        connection.request('GET' if body is None else 'POST', route,
                                           None if body is None else json.dumps(body),
                                           {'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
                        response = connection.getresponse()
                        return response.status, json.loads(response.read())
                    finally:
                        connection.close()
                try:
                    form = {**app.default_form_values(), 'seed': '12345678', 'amount_rounding_mode': 'custom',
                            'amount_rounding_percentages': '{"1000":60,"500":20,"5":20}'}
                    status, result = request('/api/generate', form)
                    self.assertEqual(status, 200, result)
                    self.assertEqual(result['history']['total_statements'], 1)
                    self.assertEqual(auth.statement_history(other)['total_statements'], 0)
                    rows = [SimpleNamespace(**row) for row in result['rows']]
                    self.assert_quotas(rows, {1000:60, 500:20, 100:0, 50:0, 10:0, 5:20})
                    self.assertEqual(auth.statement_detail(user, result['statement_id'])['config']['amount_rounding_percentages'], form['amount_rounding_percentages'])
                    with patch.object(app.traceback, 'print_exc'):
                        status, _ = request('/api/generate', {**form, 'amount_rounding_percentages':'{"1000":99}'})
                    self.assertEqual(status, 400)
                    self.assertEqual(auth.statement_history(user)['total_statements'], 1)
                    status, _ = request('/api/profile', form)
                    self.assertEqual(status, 200)
                    _, profile = request('/api/profile')
                    self.assertEqual(profile['profile']['amount_rounding_percentages'], form['amount_rounding_percentages'])
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=5)

    def test_desktop_collects_custom_percentages(self):
        from .app import StatementGeneratorApp, CUSTOM_DEFAULTS
        class Value:
            def __init__(self, value):
                self.value = value
            def get(self, *_args):
                return self.value
        config = self.config()
        values = {key: str(value) if value is not None else '' for key, value in asdict(config).items()}
        values.update(deposit_mode='Label + Name', withdrawal_mode='Label + Name', amount_rounding_mode='custom')
        values.update({f'rounding_{step}': str(percent) for step, percent in CUSTOM_DEFAULTS.items()})
        desktop = SimpleNamespace(vars={key: Value(value) for key, value in values.items()},
                                  deposit_names_text=Value('Self'), withdrawal_names_text=Value('Self'),
                                  _blocked_dates=lambda: set(),
                                  _parse_optional_date=lambda value: date.fromisoformat(value) if value else None)
        actual = StatementGeneratorApp.collect_config(desktop)
        self.assertEqual(actual.amount_rounding_mode, 'custom')
        self.assertEqual(actual.amount_rounding_percentages, CUSTOM_DEFAULTS)
        desktop.vars['rounding_1000'].value = '34'
        with self.assertRaises(ValueError):
            StatementGeneratorApp.collect_config(desktop)


if __name__ == "__main__":
    unittest.main()
