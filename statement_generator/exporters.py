from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import date, datetime
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from uuid import uuid4

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
except ImportError:  # pragma: no cover - depends on local Python install
    Workbook = None
    Alignment = Border = Font = PatternFill = Side = None

try:
    from docx import Document
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt
except ImportError:  # pragma: no cover - depends on local Python install
    Document = None
    WD_ALIGN_PARAGRAPH = Pt = None

from .exchange_rate import ExchangeRateLookupError, ExchangeRateResult, fetch_usd_npr_rate
from .generator import StatementConfig, StatementResult, validate_transaction_dates
from .utils import (
    amount_to_words_npr,
    amount_to_words_usd,
    format_amount,
    format_long_date,
    format_slash_date,
    iso_date,
    safe_filename,
    write_json,
)


STATEMENT_EXTENSIONS = {".xlsx", ".xls"}
CERTIFICATE_EXTENSIONS = {".docx", ".doc"}


@dataclass(slots=True)
class TemplateEntry:
    name: str
    path: Path
    source: str = "bundled"
    editable: bool = False


@dataclass(slots=True)
class TemplateCatalog:
    statement_templates: list[TemplateEntry]
    certificate_templates: list[TemplateEntry]


def scan_template_directory(directory: Path) -> TemplateCatalog:
    statement_templates: list[TemplateEntry] = []
    certificate_templates: list[TemplateEntry] = []
    if not directory.exists():
        return TemplateCatalog(statement_templates, certificate_templates)

    for path in sorted(directory.iterdir(), key=lambda item: item.name.lower()):
        suffix = path.suffix.lower()
        if suffix in STATEMENT_EXTENSIONS:
            statement_templates.append(TemplateEntry(path.stem, path))
        elif suffix in CERTIFICATE_EXTENSIONS:
            certificate_templates.append(TemplateEntry(path.stem, path))
    return TemplateCatalog(statement_templates, certificate_templates)


def resolve_exchange_rate(
    issue_date: date,
    mode: str,
    manual_rate: float | None,
    rate_type: str,
    timeout: int = 20,
) -> ExchangeRateResult:
    if mode == "manual":
        if not manual_rate or manual_rate <= 0:
            raise ExchangeRateLookupError("Enter a valid manual USD/NPR exchange rate before exporting.")
        return ExchangeRateResult(
            rate=manual_rate,
            rate_type=rate_type.lower(),
            source_date=issue_date,
            source_label="Manual USD/NPR Rate",
        )
    return fetch_usd_npr_rate(issue_date, rate_type=rate_type, timeout=timeout)


def build_payload(
    config: StatementConfig,
    result: StatementResult,
    exchange_rate: ExchangeRateResult | None,
    imported_check: bool = False,
) -> dict:
    errors = validate_transaction_dates(config, [asdict(row) for row in result.rows], imported_check)
    if errors:
        raise ValueError(str(errors[0]["message"]) + " Recalculate the statement before exporting.")

    def num_text(value: float, decimals: int = 2) -> str:
        return f"{float(value):.{decimals}f}"

    total_balance_npr = result.final_balance
    # A transaction statement needs no USD conversion. Certificate exports must
    # supply an actual automatic or manual rate; never substitute a made-up rate.
    equivalent_usd = round(total_balance_npr / exchange_rate.rate, 2) if exchange_rate is not None else None
    total_debit = round(sum(float(row.debit) for row in result.rows), 2)
    total_credit = round(sum(float(row.credit) for row in result.rows), 2)
    rows = [
        {
            "date": iso_date(row.date),
            "txn_date": iso_date(row.date),
            "value_date": iso_date(row.date),
            "description": row.description,
            "cheque_no": row.cheque_no,
            "debit": num_text(row.debit),
            "credit": num_text(row.credit),
            "balance": num_text(row.balance),
            "debit_text": format_amount(row.debit) if row.debit else "",
            "credit_text": format_amount(row.credit) if row.credit else "",
            "balance_text": format_amount(row.balance),
            "category": row.category,
            "is_system": row.is_system,
        }
        for row in result.rows
    ]
    return {
        "account": {
            "bank_name": config.bank_name,
            "branch_name": config.branch_name,
            "customer_name": config.customer_name,
            "customer_address": config.customer_address,
            "account_number": config.account_number,
            "account_type": config.account_type,
            "member_id": config.member_id,
            "currency": config.currency,
            "reference_no": config.reference_no,
            "opening_date_iso": iso_date(config.opening_date) if config.opening_date else "",
            "opening_date_slash": format_slash_date(config.opening_date) if config.opening_date else "",
        },
        "statement": {
            "period_from_iso": iso_date(config.start_date),
            "period_to_iso": iso_date(result.last_transaction_date),
            "period_from_slash": format_slash_date(config.start_date),
            "period_to_slash": format_slash_date(result.last_transaction_date),
            "period_label_slash": f"{format_slash_date(config.start_date)} to {format_slash_date(result.last_transaction_date)}",
            "period_label_iso": f"{iso_date(config.start_date)} to {iso_date(result.last_transaction_date)}",
            "issue_date_iso": iso_date(result.issue_date),
            "issue_date_slash": format_slash_date(result.issue_date),
            "issue_date_long": format_long_date(result.issue_date, ordinal=False),
            "issue_date_ordinal": format_long_date(result.issue_date, ordinal=True),
            "as_of_iso": iso_date(result.last_transaction_date),
            "as_of_slash": format_slash_date(result.last_transaction_date),
            "as_of_long": format_long_date(result.last_transaction_date, ordinal=False),
            "as_of_ordinal": format_long_date(result.last_transaction_date, ordinal=True),
            "opening_business_date_iso": iso_date(result.opening_business_date),
            "ending_business_date_iso": iso_date(result.ending_business_date),
            "include_cheque_column": config.include_cheque_column,
            "date_column_mode": config.date_column_mode if config.date_column_mode in {"single", "txn_value"} else "single",
        },
        "rates": {
            "interest_rate": num_text(config.interest_rate, 4).rstrip("0").rstrip("."),
            "tax_rate": num_text(config.tax_rate, 4).rstrip("0").rstrip("."),
            "usd_npr": num_text(exchange_rate.rate, 4) if exchange_rate is not None else "",
            "usd_npr_text": f"{exchange_rate.rate:,.2f}" if exchange_rate is not None else "",
            "rate_type": exchange_rate.rate_type if exchange_rate is not None else "",
            "source_label": exchange_rate.source_label if exchange_rate is not None else "",
            "source_date_iso": iso_date(exchange_rate.source_date) if exchange_rate is not None else "",
        },
        "summary": {
            "total_deposits": num_text(result.summary.total_deposits),
            "total_withdrawals": num_text(result.summary.total_withdrawals),
            "total_debit": num_text(total_debit),
            "total_credit": num_text(total_credit),
            "total_debit_text": format_amount(total_debit),
            "total_credit_text": format_amount(total_credit),
            "total_interest": num_text(result.summary.total_interest),
            "total_tax": num_text(result.summary.total_tax),
            "deposit_count": str(result.summary.deposit_count),
            "withdrawal_count": str(result.summary.withdrawal_count),
            "row_count": str(len(result.rows)),
            "final_balance": num_text(total_balance_npr),
            "final_balance_text": format_amount(total_balance_npr),
        },
        "certificate": {
            "total_balance_npr": num_text(total_balance_npr),
            "total_balance_npr_text": format_amount(total_balance_npr),
            "equivalent_usd": num_text(equivalent_usd) if equivalent_usd is not None else "",
            "equivalent_usd_text": format_amount(equivalent_usd) if equivalent_usd is not None else "",
            "balance_words_npr": amount_to_words_npr(total_balance_npr),
            "balance_words_usd": amount_to_words_usd(equivalent_usd) if equivalent_usd is not None else "",
            "authorization_details": "Authorized Signature",
        },
        "statement_rows": rows,
    }


def default_output_name(kind: str, customer_name: str, template_name: str, issue_date: date, suffix: str) -> str:
    name = safe_filename(customer_name)
    template = safe_filename(template_name)
    return f"{kind}_{name}_{issue_date.isoformat()}_{template}{suffix}"


def _resource_root() -> Path:
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent


def _resource_file(name: str) -> Path:
    root = _resource_root()
    candidates = [
        root / name,
        root / "statement_generator" / name,
        Path(__file__).resolve().parent / name,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _run_export(mode: str, template_path: Path, output_path: Path, payload: dict) -> None:
    script_path = _resource_file("office_export.ps1")
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    temp_root = _resource_root() / "_web_temp"
    temp_root.mkdir(parents=True, exist_ok=True)
    temp_dir = temp_root / f"statement_generator_{uuid4().hex}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    try:
        payload_path = temp_dir / "payload.json"
        write_json(payload_path, payload)
        command = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script_path),
            "-Mode",
            mode,
            "-TemplatePath",
            str(template_path),
            "-OutputPath",
            str(output_path),
            "-PayloadPath",
            str(payload_path),
        ]
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
            creationflags=creationflags,
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "Office export failed."
        raise RuntimeError(message)


def export_statement(template_path: Path, output_path: Path, payload: dict) -> None:
    _run_export("statement", template_path, output_path, payload)


def export_certificate(template_path: Path, output_path: Path, payload: dict) -> None:
    _run_export("certificate", template_path, output_path, payload)


def export_normal_statement(output_path: Path, payload: dict) -> None:
    if Workbook is None:
        raise RuntimeError("Normal Excel export dependency is missing in this environment.")

    from textwrap import wrap
    from openpyxl.utils import get_column_letter
    from .sample_documents import SAMPLE_LABEL

    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Statement"
    sheet.sheet_view.showGridLines = False

    statement = payload["statement"]
    account = payload["account"]
    rates = payload["rates"]
    summary = payload["summary"]
    transactions = payload["statement_rows"]
    two_dates = statement.get("date_column_mode") == "txn_value"
    include_cheque = bool(statement.get("include_cheque_column", True))

    headers = ["TXN DATE", "VALUE DATE"] if two_dates else ["DATE"]
    widths = [12.85546875] * len(headers)
    description_column = len(headers) + 1
    headers.append("DESCRIPTION")
    widths.append(24.7109375)
    if include_cheque:
        headers.append("CHEQUE NO.")
        longest_cheque = max((len(str(row["cheque_no"])) for row in transactions), default=0)
        widths.append(max(12.42578125, longest_cheque * .96 + 1.7))

    money_format = "#,##0.00;(#,##0.00)"

    def amount_width(value):
        value = float(value)
        display = f"{abs(value):,.2f}"
        return (len(display) + (2 if value < 0 else 0)) * .96 + 1.7

    headers.extend(["DEBIT", "CREDIT", "BALANCE"])
    for key, width in [("debit", 15.28515625), ("credit", 14.85546875), ("balance", 15.140625)]:
        summary_key = "final_balance" if key == "balance" else f"total_{key}"
        widest_value = max((amount_width(row[key]) for row in transactions), default=0)
        widths.append(max(width, widest_value, amount_width(summary[summary_key])))

    columns = len(widths)
    last_column = get_column_letter(columns)
    for column, width in enumerate(widths, start=1):
        sheet.column_dimensions[get_column_letter(column)].width = width

    black = Side(style="medium", color="FF000000")
    gray = Side(style="thin", color="FFD9D9D9")
    white = Side(style="thin", color="FFFFFFFF")
    outline = Border(left=black, right=black, top=black, bottom=black)
    detail_border = Border(left=gray, right=gray, top=gray, bottom=gray)
    grid = Border(left=white, right=white, top=white, bottom=white)
    header_fill = PatternFill("solid", fgColor="FF000000")
    row_fills = [PatternFill("solid", fgColor=color) for color in ("FFA6A6A6", "FFD9D9D9")]

    def cell(row, column, value, *, span=1, size=10, bold=False, align="left",
             border=None, fill=None, color="FF000000", number_format="General"):
        item = sheet.cell(row, column, value)
        if isinstance(value, str):
            item.data_type = "s"
            item.number_format = "@"
        else:
            item.number_format = number_format
        item.font = Font(name="Arial", size=size, bold=bold, color=color)
        item.alignment = Alignment(horizontal=align, vertical="center", wrap_text=True)
        if border is not None:
            item.border = border
        if fill is not None:
            item.fill = fill
        if span > 1:
            sheet.merge_cells(start_row=row, start_column=column, end_row=row, end_column=column + span - 1)

    def wrapped_height(text, width, minimum):
        lines = sum(max(1, len(wrap(line, width=max(1, int(width))))) for line in str(text).splitlines() or [""])
        return max(minimum, 15.75 + (lines - 1) * 12)

    cell(1, 1, "ACCOUNT STATEMENT", span=columns, size=16, bold=True, align="center", border=outline)
    sheet.row_dimensions[1].height = 22.5
    sheet.row_dimensions[2].height = 15.75
    details = [
        ("Name", account["customer_name"], "A/c Type", account["account_type"], 21.75),
        ("Address", account["customer_address"], "Interest", f"{rates['interest_rate']}%", 33),
        ("A/c No.", account["account_number"], "Tax", f"{rates['tax_rate']}%", 15.75),
    ]
    for row, (label, value, right_label, right_value, minimum) in enumerate(details, start=3):
        top, bottom = (black if row == 3 else gray), (black if row == 5 else gray)
        cell(row, 1, label, border=Border(left=black, right=gray, top=top, bottom=bottom))
        cell(row, 2, str(value), span=columns - 3, border=Border(left=gray, right=gray, top=top, bottom=bottom))
        cell(row, columns - 1, right_label, border=Border(left=gray, right=gray, top=top, bottom=bottom))
        cell(row, columns, str(right_value), align="right", border=Border(left=gray, right=black, top=top, bottom=bottom))
        sheet.row_dimensions[row].height = max(
            wrapped_height(value, sum(widths[1:-2]), minimum),
            wrapped_height(right_value, widths[-1], minimum),
        )
    sheet.row_dimensions[6].height = 15.75
    period = f"FROM {statement['period_from_iso']} TO {statement['period_to_iso']}"
    cell(7, 1, period, span=columns, size=11, align="center", border=outline)
    sheet.row_dimensions[7].height = 20.25
    for column, header in enumerate(headers, start=1):
        cell(8, column, header, size=11, bold=True, align="center", border=grid, fill=header_fill, color="FFFFFFFF")
    sheet.row_dimensions[8].height = 32.25

    for row, transaction in enumerate(transactions, start=9):
        fill = row_fills[(row - 9) % 2]
        common = {"size": 9, "border": grid, "fill": fill}
        dates = ([transaction.get(key) or transaction["date"] for key in ("txn_date", "value_date")]
                 if two_dates else [transaction["date"]])
        for column, value in enumerate(dates, start=1):
            cell(row, column, date.fromisoformat(value), align="center", number_format="yyyy-mm-dd", **common)
        description = transaction["description"]
        cell(row, description_column, description, **common)
        if include_cheque:
            cell(row, description_column + 1, str(transaction["cheque_no"]) or None, align="center", **common)
        for column, key in enumerate(("debit", "credit", "balance"), start=columns - 2):
            amount = float(transaction[key])
            cell(row, column, amount if key == "balance" or amount > 0 else None,
                 align="right", number_format=money_format, **common)
        sheet.row_dimensions[row].height = wrapped_height(description, widths[description_column - 1], 15.75)

    last_transaction = 8 + len(transactions)
    heading = last_transaction + 2
    sheet.row_dimensions[heading - 1].height = 15.75
    cell(heading, 1, "Transaction Summary", span=columns, bold=True, align="center", border=outline)
    sheet.row_dimensions[heading].height = 18.75
    for column, span, label, value in [
        (1, 1, "Issue Date", statement["issue_date_iso"]),
        (2, 1, "Dr. Entry", float(summary["total_debit"])),
        (3, columns - 4, "Cr. Entry", float(summary["total_credit"])),
        (columns - 1, 2, "Closing Balance", float(summary["final_balance"])),
    ]:
        cell(heading + 1, column, label, span=span, bold=True, align="center", border=detail_border)
        cell(heading + 2, column, value, span=span, bold=column != 1, size=9 if column == 1 else 10,
             align="center" if column == 1 else "right", border=detail_border, number_format=money_format)
    sheet.row_dimensions[heading + 1].height = 19.5
    sheet.row_dimensions[heading + 2].height = 22.5
    last_row = heading + 3
    cell(last_row, 1, SAMPLE_LABEL, span=columns, size=9, bold=True, align="center", color="FFA40000")
    sheet.row_dimensions[last_row].height = 18

    sheet.freeze_panes = "A9"
    if transactions:
        sheet.auto_filter.ref = f"A8:{last_column}{last_transaction}"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.page_setup.orientation = "portrait"
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.print_options.horizontalCentered = True
    sheet.page_margins.left = sheet.page_margins.right = 12 / 25.4
    sheet.page_margins.top = sheet.page_margins.bottom = 16 / 25.4
    sheet.page_margins.footer = 6 / 25.4
    sheet.print_area = f"A1:{last_column}{last_row}"
    sheet.print_title_rows = "8:8"
    sheet.oddFooter.center.text = "SAMPLE - NOT A BANK-ISSUED DOCUMENT"
    workbook.save(output_path)
    workbook.close()


def export_normal_certificate(output_path: Path, payload: dict) -> None:
    if Document is None:
        raise RuntimeError("Normal Word export dependency is missing in this environment.")

    doc = Document()
    try:
        from docx.shared import Mm  # noqa: E402

        for section in doc.sections:
            section.page_width = Mm(210)
            section.page_height = Mm(297)
            section.left_margin = Mm(12.7)
            section.right_margin = Mm(12.7)
            section.top_margin = Mm(12.7)
            section.bottom_margin = Mm(12.7)
    except Exception:
        pass
    title = doc.add_paragraph()
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = title.add_run("BALANCE CERTIFICATE")
    run.bold = True
    run.font.size = Pt(16)

    intro = doc.add_paragraph()
    intro.add_run("To whom it may concern\n").bold = True
    intro.add_run(
        f"This is to certify that the balance in the credit of the under mentioned account holder as on "
        f"{payload['statement']['as_of_ordinal']} is as follows."
    )

    lines = [
        f"Name: {payload['account']['customer_name']}",
        f"Address: {payload['account']['customer_address']}",
        f"Account Number: {payload['account']['account_number']}",
        f"Account Type: {payload['account']['account_type']}",
        f"Currency: {payload['account']['currency']}",
        f"Total Balance: NPR {payload['certificate']['total_balance_npr_text']}",
        f"Equivalent to USD: {payload['certificate']['equivalent_usd_text']}",
        f"In Words USD: {payload['certificate']['balance_words_usd']}",
        f"Exchange Rate on Issue Date: 1 USD = NPR {payload['rates']['usd_npr_text']}",
        f"Issue Date: {payload['statement']['issue_date_slash']}",
        f"Reference No.: {payload['account']['reference_no']}",
        f"In Words NPR: {payload['certificate']['balance_words_npr']}",
    ]
    for line in lines:
        paragraph = doc.add_paragraph()
        paragraph.add_run(line)

    closing = doc.add_paragraph()
    closing.add_run(
        "This certificate has been issued at the request of the account holder without obligation on the part of the institution."
    )

    signature = doc.add_paragraph("\n\nAuthorized Signature")
    signature.alignment = WD_ALIGN_PARAGRAPH.LEFT

    from .sample_documents import mark_document
    mark_document(doc)
    doc.save(output_path)
