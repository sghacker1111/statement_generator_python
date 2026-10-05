from __future__ import annotations

from dataclasses import replace
from datetime import date
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from xml.sax.saxutils import escape
from zipfile import ZipFile

from .generator import recalculate_edited_statement, validate_edited_statement, validate_transaction_dates
from .importers import import_xlsx_statement
from . import selftest


class ImportCheckTests(unittest.TestCase):
    def config(self, start="2024-10-01", end="2024-10-21"):
        return replace(selftest.GeneratorTests().build_config(), start_date=date.fromisoformat(start),
                       end_date=date.fromisoformat(end), opening_balance=365000, interest_rate=10,
                       tax_rate=6, include_cheque_column=False, holiday_dates=set())

    @staticmethod
    def row(day, description, debit, credit, balance, category=""):
        return dict(date=day, description=description, debit=debit, credit=credit,
                    balance=balance, category=category, cheque_no="")

    def posting_rows(self):
        return [self.row("2024-10-01", "Opening Balance", 0, 0, 365000, "opening"),
                self.row("2024-10-17", "Transfer in", 0, 10000, 375000),
                self.row("2024-10-17", "Transfer out", 4000, 0, 371000),
                self.row("2024-10-17", "Interest", 0, 9300, 380300),
                self.row("2024-10-17", "Tax", 558, 0, 379742),
                self.row("2024-10-21", "Balance C/F", 0, 0, 379742, "closing")]

    def test_imported_transactions_before_postings_preserve_dates_and_balances(self):
        config, rows = self.config(), self.posting_rows()
        self.assertEqual(validate_edited_statement(config, rows, imported_check=True), [])
        result = recalculate_edited_statement(config, rows, imported_check=True)
        self.assertEqual([event.date.isoformat() for event in result.events], ["2024-10-17"] * 2)
        self.assertEqual(result.final_balance, 379742)
        self.assertEqual(rows[1]["category"], "")  # Checking does not mutate the source.
        rows[1]["category"], rows[2]["category"] = "deposit", "withdrawal"
        self.assertTrue(validate_transaction_dates(config, rows))  # Generated/edit mode stays strict.

    def test_customer_rows_after_or_between_postings_are_rejected(self):
        for position in (3, 4):
            rows = self.posting_rows()
            customer = rows.pop(1)
            rows.insert(position, customer)
            errors = validate_transaction_dates(self.config(), rows, imported_check=True)
            self.assertTrue(any(error["row_index"] == position and "before interest and tax" in error["message"] for error in errors))

    def test_first_real_transaction_does_not_suppress_interest(self):
        rows = self.posting_rows()[1:]
        rows[0]["description"] = "Account opening deposit"
        config = self.config("2024-10-17")
        self.assertEqual(validate_edited_statement(config, rows, True), [])
        result = recalculate_edited_statement(config, rows, True)
        self.assertEqual(result.summary.total_interest, 9300)
        self.assertEqual(result.summary.deposit_count, 1)

    def test_opening_posting_date_skips_only_opening_postings(self):
        config = self.config("2024-07-16", "2024-10-18")
        for label in ("Balance B/F", "Balance BF", "B/F", "Balance Brought Forward", "Previous Balance", "Opening Balance"):
            for credit in (0, 365000):
                rows = [self.row("2024-07-16", label, 0, credit, 365000, "opening"),
                        self.row("2024-10-17", "Interest", 0, 9300, 374300),
                        self.row("2024-10-17", "Tax", 558, 0, 373742),
                        self.row("2024-10-18", "Balance C/F", 0, 0, 373742, "closing")]
                self.assertEqual(validate_edited_statement(config, rows, True), [], label)
                result = recalculate_edited_statement(config, rows, True)
                self.assertEqual(result.events, [])
                self.assertEqual(result.summary.total_interest, 9300)
                self.assertEqual([row.date for row in result.rows if row.category == "interest"], [date(2024, 10, 17)])
        rows[1]["credit"] += 1
        self.assertTrue(validate_edited_statement(config, rows, True))

    def test_opening_on_holiday_is_allowed_but_customer_transactions_stay_blocked(self):
        config = self.config("2026-10-17", "2026-10-20")  # Saturday and a posting date.
        rows = [self.row("2026-10-17", "Balance B/F", 0, 365000, 365000),
                self.row("2026-10-20", "Balance C/F", 0, 0, 365000, "closing")]
        self.assertEqual(validate_edited_statement(config, rows, True), [])
        rows.insert(1, self.row("2026-10-17", "Transfer in", 0, 10000, 375000))
        self.assertTrue(validate_transaction_dates(config, rows, True))
        config = self.config()
        config.holiday_dates.add(date(2024, 10, 17))
        self.assertTrue(validate_transaction_dates(config, self.posting_rows(), True))

    def test_custom_posting_date_and_secondary_date_fields(self):
        config = self.config()
        config.quarter_date_overrides = {(2024, 10): date(2024, 10, 18)}
        rows = self.posting_rows()
        for row in rows[1:5]:
            row["date"] = "2024-10-18"
        self.assertEqual(validate_transaction_dates(config, rows, True), [])
        rows[1]["value_date"] = "2024-10-19"  # Saturday.
        self.assertTrue(any("value_date" in e["fields"] for e in validate_transaction_dates(config, rows, True)))

    def test_xlsx_opening_amount_column_is_not_a_deposit(self):
        rows = [self.row("2024-07-16", "Balance B/F", 0, 365000, 365000),
                self.row("2024-07-17", "Transfer in", 0, 10000, 375000),
                self.row("2024-07-18", "Balance C/F", 0, 0, 375000)]
        values = [["Date", "Description", "Debit", "Credit", "Balance"]]
        values += [[row[key] for key in ("date", "description", "debit", "credit", "balance")] for row in rows]
        xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
        for index, cells in enumerate(values, 1):
            xml += f'<row r="{index}">' + ''.join(
                f'<c r="{chr(65 + col)}{index}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
                for col, value in enumerate(cells)) + '</row>'
        xml += '</sheetData></worksheet>'
        with TemporaryDirectory() as root:
            path = Path(root) / "sample.xlsx"
            with ZipFile(path, "w") as archive:
                archive.writestr("xl/worksheets/sheet1.xml", xml)
            imported = import_xlsx_statement(path, {})
        self.assertEqual(float(imported["form_values"]["opening_balance"]), 365000)
        self.assertEqual(float(imported["form_values"]["target_closing_balance"]), 375000)
        self.assertEqual(imported["edited_rows"][0]["category"], "opening")
        config = self.config("2024-07-16", "2024-07-18")
        self.assertEqual(validate_edited_statement(config, imported["edited_rows"], True), [])
        result = recalculate_edited_statement(config, imported["edited_rows"], True)
        self.assertEqual(result.summary.deposit_count, 1)
        self.assertEqual(result.final_balance, 375000)

    def test_http_imported_source_selects_import_checks(self):
        import app as web

        class Handler(web.StatementWebHandler):
            def _require_statement_user(self):
                return SimpleNamespace(id=7)

            def log_message(self, *_args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(web, "build_config", return_value=self.config()):
                for dates_only in (True, False):
                    for source in ("imported", "generated"):
                        connection = HTTPConnection(*server.server_address, timeout=5)
                        try:
                            rows = self.posting_rows()
                            rows[1]["category"], rows[2]["category"] = "deposit", "withdrawal"
                            connection.request("POST", "/api/validate_statement", json.dumps({
                                "config": {}, "edited_rows": rows,
                                "dates_only": dates_only, "source_type": source,
                            }), {"Content-Type": "application/json"})
                            response = connection.getresponse()
                            body = json.loads(response.read())
                            self.assertEqual(response.status, 200)
                            self.assertEqual(body["ok"], source == "imported", body)
                        finally:
                            connection.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
