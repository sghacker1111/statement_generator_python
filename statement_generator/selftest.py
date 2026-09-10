from __future__ import annotations

import unittest
from collections import Counter
from dataclasses import asdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from statistics import mean

from .generator import (
    StatementConfig,
    build_quarter_schedule,
    generate_statement,
    recalculate_edited_statement,
    simulate_statement,
    validate_edited_statement,
)
from .utils import next_business_day


class GeneratorTests(unittest.TestCase):
    def build_config(self) -> StatementConfig:
        return StatementConfig(
            bank_name="Nepal Bank Limited",
            branch_name="Main Branch",
            customer_name="Rubi Test",
            customer_address="Kathmandu, Nepal",
            account_number="1234567890",
            account_type="Saving Account",
            member_id="",
            currency="NPR",
            reference_no="",
            opening_date=date(2022, 5, 10),
            start_date=date(2024, 8, 8),
            end_date=date(2025, 9, 21),
            opening_balance=1_350_000,
            target_closing_balance=2_250_000,
            interest_rate=8.0,
            tax_rate=6.0,
            cheque_start=6_247_362,
            include_cheque_column=True,
            deposit_text="Cash Deposit",
            withdrawal_text="Cheque Withdrawal",
            interest_text="Interest",
            tax_text="Tax",
            first_date_description="Opening Balance",
            last_date_description="Balance C/F",
            deposit_names=["Self", "Kamala Pandey", "Santosh Thapa"],
            withdrawal_names=["Self", "Kabita Thapa"],
            holiday_dates={date(2025, 9, 22)},
            seed=123456,
        )

    def test_generation_reaches_target_closely(self) -> None:
        result = generate_statement(self.build_config())
        self.assertLessEqual(abs(result.final_balance - 2_250_000), 3_000)
        self.assertGreaterEqual(len(result.rows), 40)
        self.assertLessEqual(len(result.rows), 2_000)

    def test_deposit_amounts_are_not_monotonic(self) -> None:
        result = generate_statement(self.build_config())
        deposits = [event.amount for event in result.events if event.event_type == "deposit"]
        self.assertGreater(len(deposits), 3)
        self.assertNotEqual(deposits, sorted(deposits))

    def test_custom_amount_ranges_and_rounding_modes(self) -> None:
        modes = {
            "round_5": 5,
            "round_10": 10,
            "round_50": 50,
            "round_100": 100,
            "round_1000": 1_000,
            "round_500": 500,
            "round_1000_500": 500,
            "round_1000_500_100": 100,
            "round_1000_500_100_50": 50,
            "round_1000_500_100_50_10": 10,
            "round_1000_500_100_50_10_5": 5,
        }
        for mode, modulo in modes.items():
            with self.subTest(mode=mode):
                config = self.build_config()
                config.amount_rounding_mode = mode
                config.deposit_min_amount = 20_000
                config.deposit_max_amount = 120_000
                config.withdrawal_min_amount = 10_000
                config.withdrawal_max_amount = 70_000
                result = generate_statement(config)
                for event in result.events:
                    amount = int(round(event.amount))
                    self.assertEqual(amount % modulo, 0)
                    if event.event_type == "deposit":
                        self.assertGreaterEqual(amount, config.deposit_min_amount)
                        self.assertLessEqual(amount, config.deposit_max_amount)
                else:
                    self.assertGreaterEqual(amount, config.withdrawal_min_amount)
                    self.assertLessEqual(amount, config.withdrawal_max_amount)

    def test_extra_text_description_modes_are_applied(self) -> None:
        config = self.build_config()
        config.seed = 234567
        config.description_extra_text = "Mobile Transfer"
        config.deposit_name_mode = "label_extra_name"
        result = generate_statement(config)
        deposit_descriptions = [row.description for row in result.rows if row.category == "deposit"]
        self.assertTrue(any(description.startswith("Cash Deposit Mobile Transfer") for description in deposit_descriptions))

    def test_multi_year_and_custom_row_counts_are_allowed(self) -> None:
        config = self.build_config()
        config.start_date = date(2022, 1, 14)
        config.end_date = date(2025, 1, 14)
        config.opening_balance = 850_000
        config.target_closing_balance = 2_650_000
        config.seed = 987654
        auto_result = generate_statement(config)
        self.assertGreaterEqual(len(auto_result.rows), 80)

        config.statement_row_mode = "custom"
        config.statement_row_count = 140
        custom_result = generate_statement(config)
        self.assertEqual(len(custom_result.rows), 140)

    def test_issue_date_matches_next_working_day(self) -> None:
        result = generate_statement(self.build_config())
        expected = next_business_day(result.last_transaction_date, self.build_config().holiday_dates, include_self=False)
        self.assertEqual(result.issue_date, expected)
        self.assertNotEqual(result.issue_date.weekday(), 5)
        self.assertNotIn(result.issue_date, self.build_config().holiday_dates)

    def test_january_2025_quarter_date_uses_13th(self) -> None:
        schedule = build_quarter_schedule(date(2025, 1, 1), date(2025, 1, 31), set())
        self.assertIn((date(2025, 1, 13), date(2025, 1, 13)), schedule)
        self.assertNotIn((date(2025, 1, 14), date(2025, 1, 14)), schedule)

    def test_tax_rate_changes_on_2023_07_17(self) -> None:
        config = self.build_config()
        config.start_date = date(2023, 4, 1)
        config.end_date = date(2023, 7, 20)
        config.opening_balance = 1_000_000
        config.target_closing_balance = 1_000_000
        config.interest_rate = 10.0
        config.tax_rate = 6.0
        config.holiday_dates = set()
        schedule = build_quarter_schedule(config.start_date, config.end_date, set())
        self.assertIn((date(2023, 7, 17), date(2023, 7, 17)), schedule)
        rows, _summary, _final_balance, _last_transaction_date = simulate_statement(
            config,
            [],
            config.start_date,
            config.end_date,
            schedule,
            __import__("random").Random(1),
        )
        interest_by_date = {row.date: row.credit for row in rows if row.category == "interest"}
        tax_by_date = {row.date: row.debit for row in rows if row.category == "tax"}
        expected_april_tax = float((Decimal(str(interest_by_date[date(2023, 4, 13)])) * Decimal("0.05")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        expected_july_tax = float((Decimal(str(interest_by_date[date(2023, 7, 17)])) * Decimal("0.06")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
        self.assertAlmostEqual(tax_by_date[date(2023, 4, 13)], expected_april_tax)
        self.assertAlmostEqual(tax_by_date[date(2023, 7, 17)], expected_july_tax)

    def test_prepend_statement_matches_existing_start_balance(self) -> None:
        tail_config = self.build_config()
        tail_config.start_date = date(2024, 1, 14)
        tail_config.end_date = date(2025, 1, 14)
        tail_config.opening_balance = 1_000_000
        tail_config.target_closing_balance = 1_400_000
        tail_config.seed = 246810
        tail_result = generate_statement(tail_config)
        edited_rows = [asdict(row) for row in tail_result.rows]

        combined_config = self.build_config()
        combined_config.start_date = date(2022, 1, 14)
        combined_config.end_date = tail_config.end_date
        combined_config.opening_balance = 600_000
        combined_config.target_closing_balance = tail_config.target_closing_balance
        combined_config.seed = 246810
        combined_config.prepend_statement_mode = True
        combined_config.prepend_start_date = date(2022, 1, 14)
        combined_config.prepend_anchor_date = tail_config.start_date
        combined_config.prepend_anchor_balance = tail_config.opening_balance
        combined_result = recalculate_edited_statement(combined_config, edited_rows)

        previous_rows = [row for row in combined_result.rows if row.date < tail_config.start_date]
        preserved_tail = combined_result.rows[len(previous_rows):]
        anchor_opening = next(row for row in combined_result.rows if row.date == tail_config.start_date and row.category == "opening")
        self.assertGreater(len(combined_result.rows), len(tail_result.rows))
        self.assertEqual(combined_result.rows[0].date, combined_config.prepend_start_date)
        self.assertAlmostEqual(previous_rows[-1].balance, tail_result.rows[0].balance)
        self.assertAlmostEqual(anchor_opening.balance, tail_config.opening_balance)
        self.assertEqual([asdict(row) for row in preserved_tail], [asdict(row) for row in tail_result.rows])

    def test_interest_and_tax_stay_on_blocked_quarter_date_without_user_rows(self) -> None:
        config = self.build_config()
        config.holiday_dates = {date(2025, 7, 16), date(2025, 9, 22)}
        result = generate_statement(config)
        rows_on_quarter_day = [row for row in result.rows if row.date == date(2025, 7, 16)]
        categories = [row.category for row in rows_on_quarter_day]
        self.assertIn("interest", categories)
        self.assertIn("tax", categories)
        self.assertFalse(any(row.category in {"deposit", "withdrawal"} for row in rows_on_quarter_day))

    def test_imported_interest_and_tax_rows_are_not_flagged_as_blocked_transactions(self) -> None:
        config = self.build_config()
        config.holiday_dates = {date(2025, 7, 16), date(2025, 9, 22)}
        result = generate_statement(config)
        rows = [asdict(row) for row in result.rows]
        for row in rows:
            if row["category"] in {"interest", "tax"}:
                row["category"] = ""
            if row["category"] == "" and float(row["debit"]) > 0:
                row["cheque_no"] = "99999999"

        errors = validate_edited_statement(config, rows)
        blocked_messages = [
            error for error in errors
            if "Transactions are not allowed on interest/tax posting dates" in str(error["message"])
            or "Holiday/Saturday entries are not allowed" in str(error["message"])
            or "Cheque number must be numeric" in str(error["message"])
        ]
        self.assertEqual(blocked_messages, [])

    def test_first_and_last_date_descriptions_are_applied(self) -> None:
        config = self.build_config()
        config.first_date_description = "Balance B/F"
        config.last_date_description = "Closing Balance"
        result = generate_statement(config)
        opening_row = next(row for row in result.rows if row.category == "opening")
        closing_row = next(row for row in result.rows if row.category == "closing")
        self.assertEqual(opening_row.description, "Balance B/F")
        self.assertEqual(closing_row.description, "Closing Balance")

    def test_monthly_transaction_mix_varies_with_seed(self) -> None:
        config_a = self.build_config()
        config_b = self.build_config()
        config_b.seed = 123457
        result_a = generate_statement(config_a)
        result_b = generate_statement(config_b)
        month_counts_a = Counter((row.date.year, row.date.month) for row in result_a.rows if row.category in {"deposit", "withdrawal"})
        month_counts_b = Counter((row.date.year, row.date.month) for row in result_b.rows if row.category in {"deposit", "withdrawal"})
        self.assertNotEqual(dict(month_counts_a), dict(month_counts_b))

    def test_deposit_count_stays_above_withdrawals(self) -> None:
        for seed in (123456, 123457, 123458, 123459):
            config = self.build_config()
            config.seed = seed
            result = generate_statement(config)
            deposits = result.summary.deposit_count
            withdrawals = result.summary.withdrawal_count
            self.assertGreater(deposits, withdrawals)
            self.assertLessEqual(deposits - withdrawals, max(12, withdrawals))

    def test_consecutive_deposit_runs_stay_within_three(self) -> None:
        for seed in (123450, 123451, 123452, 123453, 123454, 123455, 123456, 123457, 123458, 123459):
            config = self.build_config()
            config.seed = seed
            result = generate_statement(config)
            deposit_runs: list[int] = []
            current_run = 0
            longest_run = 0
            for event in result.events:
                if event.event_type == "deposit":
                    current_run += 1
                    longest_run = max(longest_run, current_run)
                else:
                    if current_run:
                        deposit_runs.append(current_run)
                    current_run = 0
            if current_run:
                deposit_runs.append(current_run)
            self.assertLessEqual(longest_run, 3)
            self.assertTrue(any(run_length != 2 for run_length in deposit_runs))

    def test_consecutive_withdrawal_runs_stay_within_two(self) -> None:
        for seed in (123450, 123451, 123452, 123453, 123454, 123455, 123456, 123457, 123458, 123459):
            config = self.build_config()
            config.seed = seed
            result = generate_statement(config)
            withdrawal_runs: list[int] = []
            current_run = 0
            longest_run = 0
            for event in result.events:
                if event.event_type == "withdrawal":
                    current_run += 1
                    longest_run = max(longest_run, current_run)
                else:
                    if current_run:
                        withdrawal_runs.append(current_run)
                    current_run = 0
            if current_run:
                withdrawal_runs.append(current_run)
            self.assertLessEqual(longest_run, 2)
            self.assertLessEqual(sum(1 for run_length in withdrawal_runs if run_length == 2), 3)

    def test_deposit_run_lengths_vary_across_seed_sample(self) -> None:
        saw_single = False
        saw_triple = False
        for seed in (123450, 123451, 123452, 123453, 123454, 123455, 123456, 123457, 123458, 123459):
            config = self.build_config()
            config.seed = seed
            result = generate_statement(config)
            current_run = 0
            for event in result.events:
                if event.event_type == "deposit":
                    current_run += 1
                else:
                    if current_run == 1:
                        saw_single = True
                    elif current_run == 3:
                        saw_triple = True
                    current_run = 0
            if current_run == 1:
                saw_single = True
            elif current_run == 3:
                saw_triple = True
        self.assertTrue(saw_single)
        self.assertTrue(saw_triple)

    def test_run_mix_stays_near_requested_percentages(self) -> None:
        single_event_ratios: list[float] = []
        double_event_ratios: list[float] = []
        triple_event_ratios: list[float] = []
        withdrawal_double_event_ratios: list[float] = []
        for seed in (123450, 123451, 123452, 123453, 123454, 123455, 123456, 123457, 123458, 123459):
            config = self.build_config()
            config.seed = seed
            result = generate_statement(config)
            deposit_runs: list[int] = []
            withdrawal_runs: list[int] = []
            current_run = 0
            current_type = ""
            for event in result.events:
                if event.event_type == current_type:
                    current_run += 1
                else:
                    if current_type == "deposit":
                        deposit_runs.append(current_run)
                    elif current_type == "withdrawal":
                        withdrawal_runs.append(current_run)
                    current_type = event.event_type
                    current_run = 1
            if current_type == "deposit":
                deposit_runs.append(current_run)
            elif current_type == "withdrawal":
                withdrawal_runs.append(current_run)

            deposit_total = sum(deposit_runs)
            withdrawal_total = sum(withdrawal_runs)
            single_event_ratios.append(sum(run for run in deposit_runs if run == 1) / deposit_total)
            double_event_ratios.append(sum(run for run in deposit_runs if run == 2) / deposit_total)
            triple_event_ratios.append(sum(run for run in deposit_runs if run == 3) / deposit_total)
            withdrawal_double_event_ratios.append(sum(run for run in withdrawal_runs if run == 2) / withdrawal_total)

        self.assertGreaterEqual(mean(single_event_ratios), 0.15)
        self.assertLessEqual(mean(single_event_ratios), 0.35)
        self.assertGreaterEqual(mean(double_event_ratios), 0.50)
        self.assertLessEqual(mean(double_event_ratios), 0.70)
        self.assertGreaterEqual(mean(triple_event_ratios), 0.10)
        self.assertLessEqual(mean(triple_event_ratios), 0.25)
        self.assertGreaterEqual(mean(withdrawal_double_event_ratios), 0.20)
        self.assertLessEqual(mean(withdrawal_double_event_ratios), 0.40)

    def test_deposit_amounts_limit_repeats_and_keep_rounding_mix(self) -> None:
        result = generate_statement(self.build_config())
        deposits = [int(event.amount) for event in result.events if event.event_type == "deposit"]
        self.assertGreater(len(deposits), 6)
        counts = Counter(deposits)
        duplicate_groups = [value for value, count in counts.items() if count > 1]
        self.assertLessEqual(max(counts.values()), 2)
        self.assertLessEqual(len(duplicate_groups), 2)
        self.assertGreater(max(deposits), 50_000)
        self.assertTrue(any(value <= 25_000 for value in deposits))
        hundred_only_ratio = sum(1 for value in deposits if value % 500 != 0) / len(deposits)
        self.assertGreaterEqual(hundred_only_ratio, 0.10)
        self.assertLessEqual(hundred_only_ratio, 0.30)

    def test_edit_validation_flags_errors_and_recalculation_repairs_rows(self) -> None:
        config = self.build_config()
        config.start_date = date(2025, 4, 18)
        config.end_date = date(2025, 8, 20)
        config.opening_balance = 1_200_000
        config.target_closing_balance = 1_650_000
        config.interest_rate = 6.5
        config.tax_rate = 5.0
        result = generate_statement(config)
        rows = [asdict(row) for row in result.rows]

        withdrawal_indexes = [index for index, row in enumerate(rows) if row["category"] == "withdrawal"]
        self.assertGreaterEqual(len(withdrawal_indexes), 2)
        withdrawal_index = withdrawal_indexes[1]
        original_withdrawal_cheque = rows[withdrawal_index]["cheque_no"]
        rows[withdrawal_index]["description"] = config.deposit_text
        rows[withdrawal_index]["cheque_no"] = "55555555"

        interest_index = next(index for index, row in enumerate(rows) if row["category"] == "interest")
        original_interest_date = rows[interest_index]["date"]
        original_interest_credit = float(rows[interest_index]["credit"])
        rows[interest_index]["date"] = "2025-07-15"
        rows[interest_index]["credit"] = original_interest_credit + 10.0

        errors = validate_edited_statement(config, rows)
        repaired = recalculate_edited_statement(config, rows)

        withdrawal_errors = [error for error in errors if error["row_index"] == withdrawal_index]
        interest_errors = [error for error in errors if error["row_index"] == interest_index]

        self.assertTrue(any("description" in error["fields"] for error in withdrawal_errors))
        self.assertTrue(any("cheque_no" in error["fields"] for error in withdrawal_errors))
        self.assertTrue(any("date" in error["fields"] for error in interest_errors))
        self.assertTrue(any("credit" in error["fields"] for error in interest_errors))
        self.assertIn(config.withdrawal_text, repaired.rows[withdrawal_index].description)
        self.assertNotEqual(repaired.rows[withdrawal_index].description, config.deposit_text)
        self.assertEqual(repaired.rows[withdrawal_index].cheque_no, original_withdrawal_cheque)
        self.assertEqual(repaired.rows[interest_index].date.isoformat(), str(original_interest_date))
        self.assertAlmostEqual(repaired.rows[interest_index].credit, original_interest_credit, places=2)

    def test_build_config_coercion(self) -> None:
        import app
        from unittest.mock import patch
        rules = patch.object(app, "load_persistent_rules", return_value={
            "custom_holidays": set(), "excluded_saturdays": set(),
            "quarter_date_overrides": {}, "synced_quarter_dates": {},
        })
        rules.start()
        self.addCleanup(rules.stop)
        # Test that empty optional / numeric fields are coerced safely and do not raise ValueError crashes.
        form_data = {
            "bank_name": "Test Bank",
            "start_date": "2025-01-01",
            "end_date": "2025-01-31",
            "opening_balance": "",              # Should coerce to 0.0
            "target_closing_balance": "5000",
            "interest_rate": "",                # Should coerce to 0.0
            "tax_rate": "",                     # Should coerce to 0.0
            "cheque_start": "",                 # Should coerce to 0
            "statement_row_count": "",          # Should coerce to None or handle safely
            "seed": "",                         # Should coerce to None or handle safely
        }
        config = app.build_config(form_data)
        self.assertEqual(config.opening_balance, 0.0)
        self.assertEqual(config.target_closing_balance, 5000.0)
        self.assertEqual(config.interest_rate, 0.0)
        self.assertEqual(config.tax_rate, 0.0)
        self.assertEqual(config.cheque_start, 0)
        self.assertIsNone(config.statement_row_count)
        self.assertIsNone(config.seed)

        # Test invalid start/end dates raise user-friendly ValueErrors
        with self.assertRaises(ValueError) as ctx:
            app.build_config({**form_data, "start_date": ""})
        self.assertIn("Start date is required", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            app.build_config({**form_data, "start_date": "invalid-date"})
        self.assertIn("Invalid Start date format", str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            app.build_config({**form_data, "opening_date": "invalid-date"})
        self.assertIn("Invalid opening date format", str(ctx.exception))



def run_tests() -> unittest.result.TestResult:
    from .test_holidays import HolidayTests
    suite = unittest.TestSuite([
        unittest.defaultTestLoader.loadTestsFromTestCase(GeneratorTests),
        unittest.defaultTestLoader.loadTestsFromTestCase(HolidayTests),
    ])
    return unittest.TextTestRunner(verbosity=2).run(suite)


if __name__ == "__main__":
    run_tests()
