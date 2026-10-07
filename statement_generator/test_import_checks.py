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

    @staticmethod
    def write_xlsx(path, rows):
        values = [["Date", "Description", "Debit", "Credit", "Balance"]]
        values += [[row[key] for key in ("date", "description", "debit", "credit", "balance")] for row in rows]
        xml = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
        for index, cells in enumerate(values, 1):
            xml += f'<row r="{index}">' + ''.join(
                f'<c r="{chr(65 + col)}{index}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
                for col, value in enumerate(cells)) + '</row>'
        xml += '</sheetData></worksheet>'
        with ZipFile(path, "w") as archive:
            archive.writestr("xl/worksheets/sheet1.xml", xml)

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

    def test_opening_and_customer_rows_on_weekend_posting_date_are_allowed(self):
        config = self.config("2026-10-17", "2026-10-20")  # Saturday and a posting date.
        rows = [self.row("2026-10-17", "Balance B/F", 0, 365000, 365000),
                self.row("2026-10-20", "Balance C/F", 0, 0, 365000, "closing")]
        self.assertEqual(validate_edited_statement(config, rows, True), [])
        rows.insert(1, self.row("2026-10-17", "Transfer in", 0, 10000, 375000))
        self.assertEqual(validate_transaction_dates(config, rows, True), [])
        rows[1]["date"] = "2026-10-18"  # Sunday, without a scheduled posting.
        self.assertTrue(validate_transaction_dates(config, rows, True))

    def test_holiday_posting_dates_allow_customer_rows_only_before_postings(self):
        for year, manual_holiday in ((2024, True), (2026, False)):
            with self.subTest(year=year, manual_holiday=manual_holiday):
                config = self.config(f"{year}-10-01", f"{year}-10-20")
                rows = self.posting_rows()
                rows[0]["date"] = f"{year}-10-01"
                rows[-1]["date"] = f"{year}-10-20"
                for row in rows[1:5]:
                    row["date"] = f"{year}-10-17"
                    row["is_system"] = False  # Dates and amounts do not identify customer rows as postings.
                if manual_holiday:
                    config.holiday_dates.add(date(year, 10, 17))
                self.assertEqual(validate_edited_statement(config, rows, True), [])
                result = recalculate_edited_statement(config, rows, True)
                self.assertEqual([event.date for event in result.events], [date(year, 10, 17)] * 2)
                self.assertEqual(result.final_balance, 379742)
                for position in (3, 4):
                    changed = [dict(row) for row in rows]
                    customer = changed.pop(1)
                    changed.insert(position, customer)
                    errors = validate_transaction_dates(config, changed, True)
                    self.assertTrue(any(error["row_index"] == position and "before interest and tax" in error["message"] for error in errors), errors)
                rows[1]["date"] = f"{year}-10-16"
                config.holiday_dates.add(date(year, 10, 16))
                self.assertTrue(any(error["row_index"] == 1 for error in validate_transaction_dates(config, rows, True)))

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
        with TemporaryDirectory() as root:
            path = Path(root) / "sample.xlsx"
            self.write_xlsx(path, rows)
            imported = import_xlsx_statement(path, {})
        self.assertEqual(float(imported["form_values"]["opening_balance"]), 365000)
        self.assertEqual(float(imported["form_values"]["target_closing_balance"]), 375000)
        self.assertEqual(imported["edited_rows"][0]["category"], "opening")
        config = self.config("2024-07-16", "2024-07-18")
        self.assertEqual(validate_edited_statement(config, imported["edited_rows"], True), [])
        result = recalculate_edited_statement(config, imported["edited_rows"], True)
        self.assertEqual(result.summary.deposit_count, 1)
        self.assertEqual(result.final_balance, 375000)

    def test_xlsx_abbreviated_opening_on_us_posting_date_keeps_net_balance(self):
        for label in ("BAL B/F", "Balance B/F", "BALANCE BROUGHT FORWARD"):
            with self.subTest(label=label), TemporaryDirectory() as root:
                rows = [self.row("07/16/2026", label, 0, 365000, 365000),
                        self.row("10/17/2026", "Interest", 0, 9300, 374300),
                        self.row("10/17/2026", "Tax", 558, 0, 373742),
                        self.row("10/19/2026", "Balance C/F", 0, 0, 373742)]
                path = Path(root) / "opening.xlsx"
                self.write_xlsx(path, rows)
                imported = import_xlsx_statement(path, {})
                self.assertEqual(imported["form_values"]["start_date"], "2026-07-16")
                self.assertEqual(float(imported["form_values"]["opening_balance"]), 365000)
                self.assertEqual(imported["edited_rows"][0]["category"], "opening")
                config = self.config("2026-07-16", "2026-10-19")
                self.assertEqual(validate_edited_statement(config, imported["edited_rows"], True), [])
                result = recalculate_edited_statement(config, imported["edited_rows"], True)
                self.assertEqual(result.events, [])
                self.assertEqual(result.summary.total_interest, 9300)
                self.assertEqual(result.summary.total_tax, 558)
                self.assertEqual([(row.category, row.date) for row in result.rows if row.category in {"interest", "tax"}],
                                 [("interest", date(2026, 10, 17)), ("tax", date(2026, 10, 17))])
                imported["edited_rows"][1]["credit"] += 1
                self.assertTrue(validate_edited_statement(config, imported["edited_rows"], True))

    def test_missing_later_interest_and_tax_are_reported_after_opening_posting_date(self):
        config = replace(self.config("2024-07-16", "2024-10-18"), closing_row_mode="transaction_allowed")
        rows = [self.row("2024-07-16", "Balance B/F", 0, 365000, 365000),
                self.row("2024-10-18", "Transfer in", 0, 10000, 375000)]
        errors = validate_edited_statement(config, rows, True)
        for category in ("interest", "tax"):
            self.assertTrue(any(category in error["message"].lower() for error in errors), errors)

    def test_http_imported_source_selects_import_checks(self):
        import app as web

        class Handler(web.StatementWebHandler):
            def _require_statement_user(self):
                return SimpleNamespace(id=7, access_mode='unlimited')

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

    def test_check_only_xlsx_import_check_recalculate_and_reload_preserve_import_rules(self):
        import app as web
        from auth_store import AuthStore

        with TemporaryDirectory() as temp:
            root = Path(temp)
            auth = AuthStore(root / "auth.db")
            user = auth.create_user("import-check-user", "temporary-test-password", "user", "check_only",
                                    full_name="Import Test", mobile_number="0000000000")
            token = auth.login(user.username, "temporary-test-password")["token"]
            workbook = root / "statement.xlsx"
            self.write_xlsx(workbook, [
                self.row("07/16/2024", "Balance B/F", 0, 365000, 365000),
                self.row("10/17/2024", "Transfer in", 0, 10000, 375000),
                self.row("10/17/2024", "Interest", 0, 9300, 384300),
                self.row("10/17/2024", "Tax", 558, 0, 383742),
                self.row("10/18/2024", "Balance C/F", 0, 0, 383742),
            ])
            form = {**web.default_form_values(), "customer_name": "SAMPLE Customer", "interest_rate": "10",
                    "tax_rate": "6", "include_cheque_column": "No", "interest_text": "Interest", "tax_text": "Tax"}

            class Handler(web.StatementWebHandler):
                def log_message(self, *_args):
                    pass

            with patch.object(web, "AUTH_STORE", auth), patch.object(web, "STATE_FILE", root / "state.json"), \
                    patch.object(web, "USER_STATE_ROOT", root / "users"), patch.object(web, "WEB_TEMP_ROOT", root):
                server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
                thread = Thread(target=server.serve_forever, daemon=True)
                thread.start()

                def request(route, payload=None, *, body=None, content_type="application/json"):
                    connection = HTTPConnection(*server.server_address, timeout=10)
                    try:
                        connection.request("GET" if payload is None and body is None else "POST", route,
                                           body if body is not None else None if payload is None else json.dumps(payload),
                                           {"Authorization": f"Bearer {token}", "Content-Type": content_type})
                        response = connection.getresponse()
                        raw = response.read()
                        return response.status, json.loads(raw) if response.getheader('Content-Type', '').startswith('application/json') else raw
                    finally:
                        connection.close()

                try:
                    with patch.object(web, 'generate_statement', side_effect=AssertionError('Generator must not run for checker-only users')):
                        status, denied = request('/api/generate', form)
                        self.assertEqual(status, 403, denied)
                        status, denied = request('/api/export', {'config': form, 'export_kind': 'statement', 'export_mode': 'normal'})
                        self.assertEqual(status, 403, denied)
                    boundary = "sg-import-regression-boundary"
                    body = (
                        f'--{boundary}\r\nContent-Disposition: form-data; name="config"\r\n\r\n{json.dumps(form)}\r\n'
                        f'--{boundary}\r\nContent-Disposition: form-data; name="statement_file"; filename="statement.xlsx"\r\n'
                        'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'
                    ).encode() + workbook.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
                    status, imported = request("/api/import_statement", body=body,
                                               content_type=f"multipart/form-data; boundary={boundary}")
                    self.assertEqual(status, 200, imported)
                    self.assertEqual(imported["source_type"], "imported")
                    self.assertEqual(imported["current_user"]["access_mode"], "check_only")
                    self.assertEqual(imported["config"]["start_date"], "2024-07-16")
                    self.assertEqual(float(imported["config"]["opening_balance"]), 365000)
                    self.assertEqual(imported["validation_errors"], [])
                    self.assertEqual(imported["rows"][0]["category"], "opening")

                    payload = {"config": imported["config"], "edited_rows": imported["rows"],
                               "statement_id": imported["statement_id"], "source_type": imported["source_type"]}
                    for dates_only in (True, False):
                        status, checked = request("/api/validate_statement", {**payload, "dates_only": dates_only})
                        self.assertEqual(status, 200, checked)
                        self.assertTrue(checked["ok"], checked)
                    status, updated = request("/api/recalculate_statement", payload)
                    self.assertEqual(status, 200, updated)
                    self.assertEqual(updated["source_type"], "imported")
                    self.assertEqual(updated["statement_id"], imported["statement_id"])
                    self.assertEqual([(row["date"], row["credit"]) for row in updated["rows"] if row["category"] == "deposit"],
                                     [("2024-10-17", 10000)])
                    self.assertEqual([(row["date"], row["credit"], row["debit"]) for row in updated["rows"] if row["category"] in {"interest", "tax"}],
                                     [("2024-10-17", 9300, 0), ("2024-10-17", 0, 558)])
                    self.assertEqual(updated["rows"][-1]["balance"], 383742)

                    with patch.object(web, 'generate_statement', side_effect=AssertionError('Checker export must never generate')):
                        for file_type, expected_suffix in [('excel', '.xls'), ('word', '.doc')]:
                            export_request = {**payload, 'result_payload': updated, 'export_kind': 'statement',
                                              'export_mode': 'normal', 'statement_file_type': file_type,
                                              'rate_mode': 'Manual', 'manual_rate': '140'}
                            status, exported = request('/api/export', export_request)
                            self.assertEqual(status, 200, exported)
                            self.assertIn(b'Transfer in', exported)
                            self.assertIn(b'383,742', exported)
                        for invalid in ({**export_request, 'result_payload': None},
                                        {**export_request, 'source_type': 'generated'},
                                        {**export_request, 'statement_id': 0}):
                            status, denied = request('/api/export', invalid)
                            self.assertEqual(status, 403, denied)
                    for invalid in ({**payload, 'source_type': 'generated'},
                                    {**payload, 'statement_id': 0},
                                    {**payload, 'config': {**payload['config'], 'prepend_statement_mode': 'Yes'}}):
                        status, denied = request('/api/recalculate_statement', invalid)
                        self.assertEqual(status, 403, denied)

                    status, detail = request(f'/api/statement_detail?id={imported["statement_id"]}')
                    self.assertEqual(status, 200, detail)
                    self.assertEqual(detail["source_type"], "imported")
                    self.assertEqual(detail["result"]["rows"], updated["rows"])
                    status, checked = request("/api/validate_statement", {
                        "config": detail["config"], "edited_rows": detail["result"]["rows"],
                        "statement_id": detail["id"], "source_type": detail["source_type"],
                    })
                    self.assertEqual(status, 200, checked)
                    self.assertTrue(checked["ok"], checked)
                    self.assertEqual(auth.statement_history(user)["total_statements"], 1)
                finally:
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
