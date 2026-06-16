from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
import re
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from .utils import round_money


DATE_PATTERNS = (
    "%Y-%m-%d",
    "%Y/%m/%d",
    "%d/%m/%Y",
    "%d-%m-%Y",
    "%m/%d/%Y",
    "%m-%d-%Y",
    "%d.%m.%Y",
)

NS_MAIN = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
NS_REL = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}


def import_xlsx_statement(file_path: Path, current_form: dict[str, object]) -> dict[str, object]:
    if file_path.suffix.lower() != ".xlsx":
        raise RuntimeError("Only .xlsx statement files can be imported in the web app right now.")

    with ZipFile(file_path) as archive:
        shared_strings = _shared_strings(archive)
        date_styles = _date_styles(archive)
        worksheet_path = _first_worksheet_path(archive)
        sheet_xml = archive.read(worksheet_path)

    grid = _grid_from_sheet_xml(sheet_xml, shared_strings)
    header_row_number, column_map = _detect_header_row(grid)

    parsed_rows: list[dict[str, object]] = []
    for row_number in sorted(grid):
        if row_number <= header_row_number:
            continue
        cells = grid[row_number]
        date_text = _normalized_date_text(cells.get(column_map["date"]), date_styles)
        description = _cell_text(cells.get(column_map["description"], {}).get("value"))
        debit = _money_value(cells.get(column_map["debit"], {}).get("value"))
        credit = _money_value(cells.get(column_map["credit"], {}).get("value"))
        balance = _money_value(cells.get(column_map["balance"], {}).get("value"))
        cheque = _cell_text(cells.get(column_map.get("cheque", ""), {}).get("value"))

        if not date_text and not description and debit <= 0 and credit <= 0 and abs(balance) < 0.0001:
            continue
        if not date_text:
            continue

        parsed_rows.append(
            {
                "date": date_text,
                "description": description,
                "debit": debit,
                "credit": credit,
                "balance": balance,
                "cheque_no": cheque,
            }
        )

    if not parsed_rows:
        raise RuntimeError("No statement rows were found in the uploaded Excel file.")

    first_row = parsed_rows[0]
    last_row = parsed_rows[-1]
    last_row_has_amount = float(last_row["debit"]) > 0 or float(last_row["credit"]) > 0
    opening_balance = _derived_opening_balance(first_row)
    include_cheque_column = "cheque" in column_map

    corrected_rows = 0
    running_balance = opening_balance
    editable_rows: list[dict[str, object]] = []
    for index, row in enumerate(parsed_rows):
        debit = float(row["debit"])
        credit = float(row["credit"])
        expected_balance = round_money(running_balance - debit + credit)
        source_balance = float(row["balance"])
        if abs(expected_balance - source_balance) > 0.01:
            corrected_rows += 1
        running_balance = expected_balance
        category = _classify_row(str(row["description"]), debit, credit, index, len(parsed_rows))
        editable_rows.append(
            {
                "date": str(row["date"]),
                "description": str(row["description"]),
                "cheque_no": str(row["cheque_no"]) if include_cheque_column else "",
                "debit": debit,
                "credit": credit,
                "balance": source_balance,
                "category": category,
                "is_system": category in {"opening", "closing", "interest", "tax"},
            }
        )

    suggested_form = dict(current_form)
    add_before_enabled = _is_enabled(current_form.get("prepend_statement_mode"))
    if add_before_enabled:
        suggested_form["prepend_anchor_date"] = str(first_row["date"])
        suggested_form["prepend_anchor_balance"] = f"{float(first_row['balance']):.2f}"
        if current_form.get("prepend_start_date"):
            suggested_form["start_date"] = str(current_form.get("prepend_start_date"))
        else:
            suggested_form["start_date"] = str(first_row["date"])
    else:
        suggested_form["start_date"] = str(first_row["date"])
        suggested_form["opening_balance"] = f"{opening_balance:.2f}"
    suggested_form["end_date"] = str(last_row["date"])
    suggested_form["target_closing_balance"] = f"{running_balance:.2f}"
    suggested_form["first_date_description"] = str(first_row["description"] or current_form.get("first_date_description") or "Opening Balance")
    suggested_form["closing_row_mode"] = "transaction_allowed" if last_row_has_amount else "description_only"
    if not last_row_has_amount:
        suggested_form["last_date_description"] = str(
            last_row["description"] or current_form.get("last_date_description") or "Balance C/F"
        )
    suggested_form["include_cheque_column"] = "Yes" if include_cheque_column else "No"

    return {
        "form_values": suggested_form,
        "edited_rows": editable_rows,
        "report": {
            "row_count": len(editable_rows),
            "source_has_cheque_column": include_cheque_column,
            "corrected_rows": corrected_rows,
            "messages": [
                "Imported statement rows were normalized into the web app format.",
                "Cheque numbers were detected in the source statement." if include_cheque_column else "No cheque column was found in the source statement.",
            ],
        },
    }


def _is_enabled(value: object) -> bool:
    return str(value or "").strip().lower() in {"yes", "true", "1", "on", "enabled"}


def _shared_strings(archive: ZipFile) -> list[str]:
    try:
        xml = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    document = ET.fromstring(xml)
    values: list[str] = []
    for item in document.findall("x:si", NS_MAIN):
        text_node = item.find("x:t", NS_MAIN)
        if text_node is not None and text_node.text is not None:
            values.append(text_node.text)
            continue
        parts = [node.text or "" for node in item.iter() if node.tag.rsplit("}", 1)[-1] == "t"]
        values.append("".join(parts))
    return values


def _date_styles(archive: ZipFile) -> dict[int, bool]:
    try:
        xml = archive.read("xl/styles.xml")
    except KeyError:
        return {}
    document = ET.fromstring(xml)
    custom_formats: dict[int, str] = {}
    for fmt in document.findall("x:numFmts/x:numFmt", NS_MAIN):
        custom_formats[int(fmt.attrib.get("numFmtId", "0"))] = fmt.attrib.get("formatCode", "").lower()
    styles: dict[int, bool] = {}
    for index, xf in enumerate(document.findall("x:cellXfs/x:xf", NS_MAIN)):
        num_fmt_id = int(xf.attrib.get("numFmtId", "0"))
        format_code = custom_formats.get(num_fmt_id, "")
        styles[index] = _is_date_format_id(num_fmt_id) or _looks_like_date_format(format_code)
    return styles


def _first_worksheet_path(archive: ZipFile) -> str:
    try:
        workbook_xml = ET.fromstring(archive.read("xl/workbook.xml"))
        rels_xml = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    except KeyError:
        return "xl/worksheets/sheet1.xml"

    sheet = workbook_xml.find("x:sheets/x:sheet", NS_MAIN)
    relation_id = ""
    if sheet is not None:
        relation_id = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id", "")
    if not relation_id:
        return "xl/worksheets/sheet1.xml"

    for relation in rels_xml.findall("r:Relationship", NS_REL):
        if relation.attrib.get("Id", "") != relation_id:
            continue
        target = relation.attrib.get("Target", "")
        if not target:
            break
        normalized = target.lstrip("/")
        return normalized if normalized.startswith("xl/") else f"xl/{normalized}"
    return "xl/worksheets/sheet1.xml"


def _grid_from_sheet_xml(sheet_xml: bytes, shared_strings: list[str]) -> dict[int, dict[str, dict[str, object]]]:
    document = ET.fromstring(sheet_xml)
    grid: dict[int, dict[str, dict[str, object]]] = {}
    for row_node in document.findall("x:sheetData/x:row", NS_MAIN):
        row_number = int(row_node.attrib.get("r", "0"))
        if row_number < 1:
            continue
        row_cells: dict[str, dict[str, object]] = {}
        for cell in row_node.findall("x:c", NS_MAIN):
            reference = cell.attrib.get("r", "")
            column = re.sub(r"[^A-Z]+", "", reference.upper())
            if not column:
                continue
            cell_type = cell.attrib.get("t", "").lower()
            style_id = int(cell.attrib.get("s", "0"))
            value = ""
            if cell_type == "s":
                shared_index = int(cell.findtext("x:v", default="0", namespaces=NS_MAIN))
                value = shared_strings[shared_index] if 0 <= shared_index < len(shared_strings) else ""
            elif cell_type == "inlinestr":
                value = "".join(node.text or "" for node in cell.iter() if node.tag.rsplit('}', 1)[-1] == "t").strip()
            else:
                value = cell.findtext("x:v", default="", namespaces=NS_MAIN).strip()
            row_cells[column] = {"value": value, "type": cell_type, "style_id": style_id}
        grid[row_number] = row_cells
    return grid


def _detect_header_row(grid: dict[int, dict[str, dict[str, object]]]) -> tuple[int, dict[str, str]]:
    for row_number in sorted(grid):
        mapping: dict[str, str] = {}
        for column, cell in grid[row_number].items():
            text = _cell_text(cell.get("value")).lower()
            if text in {"date", "value date"} or "transaction date" in text or "txn date" in text:
                mapping["date"] = column
            elif "description" in text or "particular" in text:
                mapping["description"] = column
            elif "cheque" in text or "chq" in text:
                mapping["cheque"] = column
            elif "debit" in text or "withdraw" in text:
                mapping["debit"] = column
            elif "credit" in text or "deposit" in text:
                mapping["credit"] = column
            elif "balance" in text:
                mapping["balance"] = column
        if {"date", "description", "debit", "credit", "balance"}.issubset(mapping):
            return row_number, mapping
    raise RuntimeError("Could not find statement columns in the uploaded Excel file.")


def _normalized_date_text(cell: dict[str, object] | None, date_styles: dict[int, bool]) -> str:
    if not cell:
        return ""
    value = _cell_text(cell.get("value"))
    if not value:
        return ""

    style_id = int(cell.get("style_id", 0) or 0)
    if date_styles.get(style_id, False) and _is_number(value):
        return _excel_serial_to_iso(float(value))
    if _is_number(value) and float(value) > 20_000:
        return _excel_serial_to_iso(float(value))

    for pattern in DATE_PATTERNS:
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(value).date().isoformat()
    except ValueError:
        return ""


def _money_value(value: object) -> float:
    cleaned = _cell_text(value).replace(",", "").replace("Rs.", "").replace("NPR", "").replace("$", "").strip()
    if not cleaned or not _is_number(cleaned):
        return 0.0
    return round_money(float(cleaned))


def _cell_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _classify_row(description: str, debit: float, credit: float, index: int, total_rows: int) -> str:
    text = description.strip().lower()
    if index == 0 and ((credit <= 0 and debit <= 0) or "opening" in text or "balance b/f" in text):
        return "opening"
    if index == total_rows - 1 and credit <= 0 and debit <= 0 and ("closing" in text or "balance c/f" in text):
        return "closing"
    if "interest" in text:
        return "interest"
    if "tax" in text:
        return "tax"
    if credit > 0 and debit <= 0:
        return "deposit"
    if debit > 0 and credit <= 0:
        return "withdrawal"
    return "withdrawal"


def _derived_opening_balance(first_row: dict[str, object]) -> float:
    debit = float(first_row.get("debit", 0.0) or 0.0)
    credit = float(first_row.get("credit", 0.0) or 0.0)
    balance = float(first_row.get("balance", 0.0) or 0.0)
    if debit <= 0 and credit <= 0:
        return round_money(balance)
    return round_money(balance + debit - credit)


def _is_date_format_id(num_fmt_id: int) -> bool:
    return 14 <= num_fmt_id <= 22 or 45 <= num_fmt_id <= 47


def _looks_like_date_format(format_code: str) -> bool:
    lowered = format_code.lower()
    return bool(lowered) and ("yy" in lowered or "dd" in lowered or "mm" in lowered)


def _excel_serial_to_iso(serial: float) -> str:
    base = date(1899, 12, 30)
    return (base + timedelta(days=int(serial))).isoformat()


def _is_number(value: str) -> bool:
    try:
        float(value)
        return True
    except ValueError:
        return False
