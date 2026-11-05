"""Native uploads must keep the workbook and move its formulas with the rows."""
import os
from datetime import datetime
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import app
from .exporters import export_statement, scan_template_directory


class StatementTemplateTests(unittest.TestCase):
    def setUp(self):
        from openpyxl import Workbook
        from openpyxl.styles import Font
        from openpyxl.cell.rich_text import CellRichText, TextBlock
        from openpyxl.cell.text import InlineFont

        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        workbook = Workbook()
        checks = workbook.active
        checks.title = "Checks"
        checks["A1"] = "=Ledger!F11+B11"
        checks["B11"] = 12
        sheet = workbook.create_sheet("Ledger")
        sheet.merge_cells("A1:G1")
        sheet["A1"] = "ACCOUNT STATEMENT"
        for address, value in {
            "A2": "Name: Old Name", "A3": "Address:", "B3": "Old address",
            "A4": "A/c No.", "B4": "00000123", "E3": "Interest", "F3": .0825,
            "E4": "Tax rate: 5% (TDS)", "A5": "Account Type", "B5": "Savings",
        }.items():
            sheet[address] = value
        sheet.merge_cells("B3:D3")
        sheet["A2"] = CellRichText([TextBlock(InlineFont(b=True), "Name: "), TextBlock(InlineFont(b=False), "Old Name")])
        sheet["F3"].number_format = "0.00%"
        for column, value in enumerate(("Date", "Description", "Cheque No.", "Debit", "Credit", "Balance", "Audit"), 1):
            sheet.cell(8, column, value)
        for row in range(9, 12):
            sheet.cell(row, 1, datetime(2026, 1, row)).number_format = "dd-mmm-yyyy"
            sheet.cell(row, 2, "Old transaction").font = Font(name="Arial", bold=True)
            sheet.cell(row, 4, 10.5).number_format = "0.0000"
            sheet.cell(row, 5, 30.5)
            sheet.cell(row, 6, 1000 if row == 9 else f"=F{row-1}-D{row}+E{row}")
            sheet.cell(row, 7, f"=D{row}+E{row}")
            sheet.row_dimensions[row].height = 23
        sheet["B12"] = "Total"
        sheet["D12"] = "=SUM(D9:D11)"
        sheet["E12"] = "=SUM(E9:E11)"
        sheet["F12"] = "=F11"
        sheet["A14"] = "Closing Balance"
        sheet.merge_cells("A14:B14")
        sheet["C14"] = "=F12"
        sheet.auto_filter.ref = "A8:G11"
        sheet.freeze_panes = "C9"
        sheet.print_area = "A1:G15"
        sheet.print_title_rows = "8:8"
        sheet.column_dimensions["B"].width = 34
        sheet.page_setup.orientation = "landscape"
        sheet.page_setup.paperSize = 9
        sheet.page_margins.left = .43
        self.source = self.root / "Layout.xlsx"
        workbook.save(self.source)
        workbook.close()

    def test_upload_keeps_original_and_detects_profile_on_later_tab(self):
        original = self.source.read_bytes()
        with patch.object(app, "CUSTOM_TEMPLATE_ROOT", self.root / "custom"):
            saved = app.save_uploaded_template("statement", self.source.name, original, "", 555, {"interest_rate": "99"})
            layout = saved["statement_layout"]
            self.assertEqual(layout["sheet"], "Ledger")
            self.assertEqual((layout["start"], layout["end"]), (9, 11))
            self.assertEqual(saved["profile"]["account_number"], "00000123")
            self.assertEqual(saved["profile"]["interest_rate"], "8.25")
            target = app._custom_template_dir("statement", 555) / "Layout.xlsx"
            self.assertEqual(target.read_bytes(), original)
            detail = app.template_detail("statement", "Layout", "", 555)
            self.assertEqual(detail["active_sheet"], "Ledger")
            self.assertEqual(detail["page_setup"]["orientation"], "landscape")
            self.assertEqual(target.read_bytes(), original)

    def test_retired_samples_are_excluded_and_new_uploads_can_use_their_names(self):
        (self.root / "Elba.xlsx").write_bytes(self.source.read_bytes())
        catalog = scan_template_directory(self.root)
        self.assertEqual([entry.name for entry in catalog.statement_templates], ["Layout"])
        self.assertEqual(len(scan_template_directory(self.root, uploaded=True).statement_templates), 2)

    @unittest.skipUnless(os.environ.get("STATEMENT_TEST_EXCEL") == "1", "Run with STATEMENT_TEST_EXCEL=1 on a machine with Excel")
    def test_excel_exports_keep_formula_chains_and_totals_for_more_and_fewer_rows(self):
        from openpyxl import load_workbook

        for count in (2, 6):
            payload = {
                "account": {"customer_name": "New Name", "customer_address": "New address", "account_number": "0000456", "account_type": "Current"},
                "rates": {"interest_rate": "7", "tax_rate": "6"},
                "statement": {"period_from_iso": "2026-01-01", "period_to_iso": "2026-02-01"},
                "summary": {"total_debit": 5*(count-1), "total_credit": 20*(count-1), "final_balance": 1000+15*(count-1)},
                "statement_rows": [
                    {"date": f"2026-01-{index+1:02d}", "description": "Generated row", "cheque_no": "000009" if index else "",
                     "debit": 5 if index else 0, "credit": 20 if index else 0, "balance": 1000+15*index}
                    for index in range(count)
                ],
            }
            output = self.root / f"export-{count}.xlsx"
            export_statement(self.source, output, payload)
            book = load_workbook(output, rich_text=True)
            sheet = book["Ledger"]
            for row in range(10, 9+count):
                self.assertEqual(sheet[f"F{row}"].value, f"=F{row-1}-D{row}+E{row}")
                self.assertEqual(sheet[f"G{row}"].value, f"=D{row}+E{row}")
            self.assertEqual(sheet[f"D{9+count}"].value, f"=SUM(D9:D{8+count})")
            self.assertEqual(book["Checks"]["A1"].value, f"=Ledger!F{8+count}+B11")
            self.assertEqual(str(sheet["A2"].value), "Name: New Name")
            self.assertTrue(sheet["A2"].value[0].font.b)
            self.assertFalse(sheet["A2"].value[1].font.b)
            self.assertEqual(sheet["E4"].value, "Tax rate: 6% (TDS)")
            self.assertEqual(sheet["C10"].value, "000009")
            self.assertEqual(sheet["A10"].number_format.replace("\\", ""), "dd-mmm-yyyy")
            self.assertEqual(sheet["D10"].number_format, "0.0000")
            self.assertAlmostEqual(sheet.row_dimensions[10].height, 23, delta=.2)
            self.assertEqual(sheet.page_setup.orientation, "landscape")
            self.assertEqual(sheet.auto_filter.ref, f"A8:G{8+count}")
            self.assertIn("B3:D3", sheet.merged_cells)
            book.close()
            calculated = load_workbook(output, data_only=True)
            self.assertEqual(calculated["Ledger"][f"F{8+count}"].value, 1000 + 15*(count-1))
            calculated.close()
