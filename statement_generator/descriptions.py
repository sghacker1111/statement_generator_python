"""Description composition and saved-profile checks, with legacy profile defaults."""
import json
import re

ORDERS = {
    "label_plus_name": ("label", "name"), "name_plus_label": ("name", "label"),
    "name_only": ("name",), "label_only": ("label",), "extra_only": ("extra",),
    "extra_name": ("extra", "name"), "name_extra": ("name", "extra"),
    "label_extra": ("label", "extra"), "extra_label": ("extra", "label"),
    **{order: tuple(order.split("_")) for order in (
        "label_extra_name", "label_name_extra", "name_label_extra",
        "name_extra_label", "extra_label_name", "extra_name_label")},
}
FIELDS = [f"{side}_{field}" for side in ("deposit", "withdrawal")
          for field in ("description_parts", "connector_enabled", "connector_text")]
CHECK_FIELDS = FIELDS + ["deposit_mode", "withdrawal_mode", "deposit_text", "withdrawal_text",
                        "description_extra_text", "interest_text", "tax_text",
                        "first_date_description", "last_date_description", "deposit_names", "withdrawal_names"]


def parts(value, mode="label_plus_name"):
    if value is None or value == "":
        return ORDERS.get(mode, ORDERS["label_plus_name"])
    try:
        values = json.loads(value) if isinstance(value, str) else value
    except (ValueError, TypeError) as error:
        raise ValueError("Description order must contain up to three parts.") from error
    if not isinstance(values, (list, tuple)) or len(values) > 3 or any(not isinstance(v, str) or v not in {"none", "name", "label", "extra"} for v in values):
        raise ValueError("Choose None, Name, Label or Extra Text for each description part.")
    selected = tuple(v for v in values if v != "none")
    if not selected or len(set(selected)) != len(selected):
        raise ValueError("Choose at least one description part, without duplicates.")
    return selected


def _tokens(config, side, name):
    mode = getattr(config, side + "_name_mode")
    custom = getattr(config, side + "_description_parts", "")
    order = parts(custom, mode)
    base = getattr(config, side + "_text").strip() or ("Cash Deposit" if side == "deposit" else "Cheque Withdrawal")
    values = {"name": name, "label": base, "extra": config.description_extra_text.strip()}
    enabled = getattr(config, side + "_connector_enabled", "legacy")
    enabled = (mode == "label_plus_name" if enabled == "legacy" else str(enabled).lower() in {"yes", "true", "1", "on"})
    connector = getattr(config, side + "_connector_text", "by").strip()
    result = []
    for part in order:
        if not values[part]:
            continue
        if part == "name" and result and enabled and connector:
            result.append(connector)
        result.append(values[part])
    return result or [base]


def compose(config, side, name):
    return " ".join(_tokens(config, side, name)).strip()


def profile_message(config, category, description):
    normalized = " ".join(description.split())
    system = {"opening": "first_date_description", "closing": "last_date_description",
              "interest": "interest_text", "tax": "tax_text"}
    if category in system:
        expected = " ".join(getattr(config, system[category]).split())
        return "" if normalized == expected else f"{category.title()} description must match the saved profile: {expected}."
    side = "deposit" if category == "deposit" else "withdrawal" if category == "withdrawal" else ""
    if not side:
        return ""
    if side == "withdrawal" and not config.include_cheque_column:
        normalized = re.sub(r"\s+CHQ\. No\. \d+$", "", normalized)
    marker = "\x00NAME\x00"
    tokens = _tokens(config, side, marker)
    pattern = r"\s+".join(r".+?" if item == marker else re.escape(" ".join(item.split())) for item in tokens)
    return "" if re.fullmatch(pattern, normalized) else f"{side.title()} description does not match the saved profile order, label, connector or extra text."
