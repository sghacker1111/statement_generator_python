"""Map a native statement worksheet without changing the original workbook."""
from __future__ import annotations

import re
from datetime import date

HEADERS = {
    "date": r"date|posting date",
    "txn_date": r"txn date|transaction date",
    "value_date": r"value date",
    "description": r"description|particulars?|narration|transaction details",
    "cheque_no": r"(?:cheque|check|chq)(?: no| number)?",
    "debit": r"(?:debit|withdrawal|withdrawals)(?: amount| npr)?",
    "credit": r"(?:credit|deposit|deposits)(?: amount| npr)?",
    "balance": r"(?:running |closing )?balance(?: amount| npr)?",
}
FIELDS = {
    "customer_name": r"name|(?:account|customer|member) name|(?:account )?holder(?: s)?(?: name)?",
    "customer_address": r"(?:(?:permanent|mailing|customer|contact) )?address",
    "account_number": r"(?:account|a c|ac|acct) (?:no|number)",
    "account_type": r"(?:account|a c|ac|acct) type",
    "interest_rate": r"interest(?: rate)?(?: daily| p a)?",
    "tax_rate": r"(?:tax|tds|withholding tax)(?: rate)?",
    "member_id": r"member (?:id|no|number)",
    "currency": r"currency",
}
SUMMARY = {
    "total_debit": r"total debit(?: amount)?|debit total|debit amount",
    "total_credit": r"total credit(?: amount)?|credit total|credit amount",
    "final_balance": r"(?:total|ending|closing|final|available) balance",
    "total_deposits": r"total deposits?",
    "total_withdrawals": r"total withdrawals?",
    "total_interest": r"total interest",
    "total_tax": r"total tax",
}
RATE_FIELDS = {"interest_rate", "tax_rate"}


def _text(value):
    return "" if value is None else str(value).strip()


def _label(text):
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _match(text, aliases):
    label = _label(text)
    return next((key for key, pattern in aliases.items() if re.fullmatch(pattern, label)), None)


def _fields(worksheet, rows, aliases):
    fields = {}
    merges = {(r.min_row, r.min_col): r.max_col for r in worksheet.merged_cells.ranges}
    for row, cells in rows.items():
        for col, cell in cells.items():
            parts = re.split(r"(\s*[:：]\s*-?\s*)", _text(cell.value), maxsplit=1)
            key = _match(parts[0], aliases)
            if key is None or key in fields:
                continue
            if len(parts) == 3 and parts[2]:
                fields[key] = {"cell": cell.coordinate, "prefix": parts[0] + parts[1], "value": parts[2]}
                continue
            target = None
            end_col = merges.get((row, col), col)
            for column in range(end_col + 1, end_col + 5):
                candidate = cells.get(column)
                if candidate is None:
                    continue
                text = _text(candidate.value)
                if re.fullmatch(r"[:：\s-]+", text):
                    continue
                if _match(re.split(r"[:：]", text, maxsplit=1)[0], aliases):
                    break
                if text:
                    target = candidate
                    break
                if candidate.has_style:
                    target = target or candidate
            if aliases is SUMMARY and target is None:
                below = rows.get(row + 1, {}).get(col)
                if below is not None and (below.data_type == "f" or isinstance(below.value, (int, float))):
                    target = below
            if target is not None:
                fields[key] = {"cell": target.coordinate, "prefix": "", "value": ""}
    return fields


def scan_statement_layout(workbook):
    from openpyxl.utils import get_column_letter

    for sheet in workbook.worksheets:
        rows = {}
        for (row, col), cell in sorted(sheet._cells.items()):
            if cell.value is not None or cell.has_style:
                rows.setdefault(row, {})[col] = cell
        for header, cells in rows.items():
            columns = {}
            for col, cell in cells.items():
                key = _match(_text(cell.value), HEADERS)
                if key:
                    columns.setdefault(key, col)
            date_col = columns.get("date") or columns.get("txn_date") or columns.get("value_date")
            if not date_col or not {"description", "debit", "credit", "balance"} <= columns.keys():
                continue
            end = header
            while record := rows.get(end + 1):
                date_value = record[date_col].value if date_col in record else None
                desc = record.get(columns["description"])
                balance = record.get(columns["balance"])
                dated = isinstance(date_value, (date, int, float)) or bool(re.search(r"\d.*[/-].*\d", _text(date_value)))
                opening = desc and balance and balance.value is not None and re.search(
                    r"\b(opening|previous|brought forward|b f)\b", _label(_text(desc.value))
                )
                styled_blank = (
                    all(col in record and record[col].has_style for col in columns.values())
                    and all(not _text(cell.value) for cell in record.values())
                )
                if not (dated or opening or styled_blank):
                    break
                end += 1
            fields = _fields(sheet, {r: v for r, v in rows.items() if r < header}, FIELDS)
            summary = _fields(sheet, {r: v for r, v in rows.items() if r > end}, SUMMARY)
            profile = {}
            for key, field in fields.items():
                cell = sheet[field["cell"]]
                value = field["value"] if field["prefix"] else cell.value
                if key in RATE_FIELDS:
                    if isinstance(value, (int, float)) and "%" in cell.number_format:
                        value = f"{value * 100:g}"
                    match = re.match(r"-?\d+(?:\.\d+)?", _text(value))
                    value = match[0] if match else None
                if key == "account_number" and isinstance(value, (int, float)) and re.fullmatch(r"0+", cell.number_format):
                    value = str(int(value)).zfill(len(cell.number_format))
                if _text(value) and cell.data_type != "f":
                    profile[key] = _text(value)
            return {
                "sheet": sheet.title,
                "sheets": workbook.sheetnames,
                "header_row": header,
                "columns": {key: get_column_letter(col) for key, col in columns.items()},
                "start": header + 1,
                "end": end,
                "fields": fields,
                "summary": summary,
                "profile": profile,
            }
    return None
