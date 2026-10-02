from collections import Counter
from datetime import date
from itertools import groupby
from pathlib import Path
import random
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from . import selftest
from .generator import generate_statement
from .rounding import prepare_mix
from .transaction_runs import RUN_DEFAULTS, parse_run_rules, transaction_sequence


COUNT_RULES = {"debit_run_mode": "count", "debit_run_2": 3, "debit_run_3": 2,
               "credit_run_mode": "count", "credit_run_2": 2, "credit_run_3": 4, "credit_run_4": 3}
PERCENT_RULES = {"debit_run_mode": "percentage", "debit_run_2": 30, "debit_run_3": 50,
                 "credit_run_mode": "percentage", "credit_run_2": 20, "credit_run_3": 40, "credit_run_4": 40}


def run_counts(sequence):
    return Counter((kind, len(list(items))) for kind, items in groupby(sequence))


class TransactionRunTests(unittest.TestCase):
    def test_manual_counts_are_exact_and_randomly_placed(self):
        expected = {("withdrawal", 1): 6, ("withdrawal", 2): 3, ("withdrawal", 3): 2,
                    ("deposit", 1): 2, ("deposit", 2): 2, ("deposit", 3): 4, ("deposit", 4): 3}
        firsts, lasts, sections, orders = set(), set(), set(), set()
        for seed in range(150):
            sequence = transaction_sequence(30, 18, random.Random(seed), COUNT_RULES)
            self.assertEqual(run_counts(sequence), expected)
            runs = [(kind, len(list(items))) for kind, items in groupby(sequence)]
            firsts.add(runs[0])
            lasts.add(runs[-1])
            offset = 0
            for kind, length in runs:
                if (kind, length) in {("withdrawal", 3), ("deposit", 4)}:
                    sections.add((kind, min(2, offset // 16)))
                offset += length
            orders.add(tuple(sequence))
        self.assertEqual(firsts, set(expected))
        self.assertEqual(lasts, set(expected))
        self.assertEqual(len(sections), 6)
        self.assertGreater(len(orders), 140)
        self.assertEqual(transaction_sequence(30, 18, random.Random(7), COUNT_RULES),
                         transaction_sequence(30, 18, random.Random(7), COUNT_RULES))

    def test_percentage_uses_each_side_and_complete_groups(self):
        sequence = transaction_sequence(30, 18, random.Random(2), PERCENT_RULES)
        self.assertEqual(run_counts(sequence), {("withdrawal", 1): 5, ("withdrawal", 2): 2,
                         ("withdrawal", 3): 3, ("deposit", 2): 3, ("deposit", 3): 4, ("deposit", 4): 3})
        sequence = transaction_sequence(32, 20, random.Random(3),
                                       {"debit_run_mode": "percentage", "debit_run_2": 20, "debit_run_3": 30})
        self.assertEqual(run_counts(sequence)[("withdrawal", 3)], 2)
        self.assertEqual(run_counts(sequence)[("withdrawal", 2)], 2)
        # A positive percentage smaller than one whole group remains singles.
        sequence = transaction_sequence(30, 18, random.Random(4),
                                       {"debit_run_mode": "percentage", "debit_run_2": 1, "debit_run_3": 1})
        self.assertEqual(run_counts(sequence)[("withdrawal", 1)], 18)

    def test_zero_manual_fields_are_honored_and_impossible_settings_rejected(self):
        sequence = transaction_sequence(30, 18, random.Random(3), {"debit_run_mode": "count"})
        self.assertEqual(run_counts(sequence)[("withdrawal", 1)], 18)
        for rules in ({"debit_run_mode": "count", "debit_run_3": 20},
                      {"debit_run_mode": "count", "credit_run_mode": "count"}):
            with self.assertRaisesRegex(ValueError, "consecutive transaction settings"):
                transaction_sequence(30, 18, random.Random(1), rules)

    def test_invalid_manual_values_fail_and_automatic_ignores_inactive_fields(self):
        for rules in ({"debit_run_mode": "other"},
                      {"debit_run_mode": "count", "debit_run_2": 1.5},
                      {"debit_run_mode": "count", "debit_run_2": -1},
                      {"debit_run_mode": "count", "debit_run_2": True},
                      {"debit_run_mode": "percentage", "debit_run_2": "NaN"},
                      {"credit_run_mode": "percentage", "credit_run_4": float("inf")},
                      {"credit_run_mode": "percentage", "credit_run_2": 60, "credit_run_3": 41}):
            with self.assertRaises(ValueError):
                parse_run_rules(rules)
        self.assertEqual(parse_run_rules({"debit_run_2": "invalid"})["debit_run_2"], 0)

    def test_count_selection_respects_runs_before_assigning_amounts(self):
        config = selftest.GeneratorTests().build_config()
        for key, value in COUNT_RULES.items():
            setattr(config, key, value)
        for seed in range(25):
            mix = prepare_mix(48, config, random.Random(seed))
            self.assertEqual(sum(mix["demands"][2:]), 18)

    def test_generated_statement_keeps_manual_groups_amount_rules_and_monthly_counts(self):
        for rules in (COUNT_RULES, PERCENT_RULES):
            config = selftest.GeneratorTests().build_config()
            config.start_date, config.end_date = date(2025, 1, 1), date(2026, 3, 31)
            config.transaction_count_mode = "custom"
            config.monthly_transaction_counts = {(2025, month): 4 for month in range(1, 13)}
            config.opening_balance = 1_000_000
            config.target_closing_balance = 1_600_000
            for key, value in rules.items():
                setattr(config, key, value)
            result = generate_statement(config)
            credits = [e.amount for e in result.events if e.event_type == "deposit"]
            debits = [e.amount for e in result.events if e.event_type == "withdrawal"]
            expected_sequence = transaction_sequence(len(credits), len(debits), random.Random(1), rules)
            self.assertEqual(run_counts(e.event_type for e in result.events), run_counts(expected_sequence))
            self.assertEqual(Counter((e.date.year, e.date.month) for e in result.events), config.monthly_transaction_counts)
            self.assertTrue(45 * len(credits) <= 100 * len(debits) <= 70 * len(credits))
            self.assertTrue(10 * len(debits) <= 100 * sum(a > 50000 for a in debits) <= 20 * len(debits))
            self.assertTrue(20 * len(credits) <= 100 * sum(a < 30000 for a in credits) <= 30 * len(credits))
            amounts = credits + debits
            groups = Counter("large" if a % 500 == 0 else "medium" if a % 50 == 0 else "small" for a in amounts)
            for group, percent in (("large", 70), ("medium", 20), ("small", 10)):
                self.assertLess(abs(groups[group] - len(amounts) * percent / 100), 1.000001)
            self.assertLessEqual(abs(result.final_balance - config.target_closing_balance), 3000)
            self.assertTrue(all(row.balance >= 0 for row in result.rows))

    def test_web_config_and_saved_profiles_preserve_both_modes(self):
        import app
        with TemporaryDirectory() as temp, patch.object(app, "STATE_FILE", Path(temp) / "state.json"):
            for rules in (COUNT_RULES, PERCENT_RULES, {}):
                form = {**app.default_form_values(), **rules}
                config = app.build_config(form)
                self.assertEqual(parse_run_rules(config), parse_run_rules(form))
                saved = {key: str(form[key]) for key in app.profile_field_keys()}
                self.assertEqual(parse_run_rules(app.build_config(saved)), parse_run_rules(form))
            self.assertTrue(set(RUN_DEFAULTS) <= set(app.profile_field_keys()))


if __name__ == "__main__":
    unittest.main()
