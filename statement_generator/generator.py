from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field, replace
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import random
from typing import Literal

from .rounding import parse_percentages, assign_rounding, adjust_plan, validate_amount_mix, prepare_mix

from .utils import (
    ceil_two_decimals,
    format_amount,
    is_business_day,
    iso_date,
    next_business_day,
    parse_multiline_list,
    resolve_business_day,
    round_money,
    round_to_step,
)


EventType = Literal["deposit", "withdrawal"]

DEPOSIT_MIN_AMOUNT = 15_000
DEPOSIT_MAX_AMOUNT = 99_000
WITHDRAWAL_MIN_AMOUNT = 15_000
WITHDRAWAL_MAX_AMOUNT = 65_000

DEPOSIT_LOW_MAX_AMOUNT = 32_000
DEPOSIT_MID_MAX_AMOUNT = 65_000
DEPOSIT_HIGH_BAND_MIN_AMOUNT = 68_000
WITHDRAWAL_LOW_MAX_AMOUNT = 28_000
WITHDRAWAL_MID_MAX_AMOUNT = 42_000
WITHDRAWAL_HIGH_BAND_MIN_AMOUNT = 44_000

MIN_CUSTOM_STATEMENT_ROWS = 10
DEFAULT_MIN_STATEMENT_ROWS = 40
MAX_STATEMENT_ROWS = 2_000
DEFAULT_MONTHLY_TRANSACTION_CAP = 3
CUSTOM_MONTHLY_TRANSACTION_CAP = 50

QUARTER_DEFAULT_DAYS = {
    1: 14,
    4: 13,
    7: 16,
    10: 17,
}
QUARTER_DAY_OVERRIDES = {
    (2023, 7): 17,
    (2025, 1): 13,
}

TAX_RATE_CHANGE_DATE = date(2023, 7, 17)
LEGACY_TAX_RATE = 5.0


@dataclass(slots=True)
class StatementConfig:
    bank_name: str
    branch_name: str
    customer_name: str
    customer_address: str
    account_number: str
    account_type: str
    member_id: str
    currency: str
    reference_no: str
    opening_date: date | None
    start_date: date
    end_date: date
    opening_balance: float
    target_closing_balance: float
    interest_rate: float
    tax_rate: float
    cheque_start: int
    include_cheque_column: bool
    deposit_text: str
    withdrawal_text: str
    interest_text: str
    tax_text: str
    prepend_statement_mode: bool = False
    prepend_start_date: date | None = None
    prepend_anchor_date: date | None = None
    prepend_anchor_balance: float = 0.0
    deposit_min_amount: int = DEPOSIT_MIN_AMOUNT
    deposit_max_amount: int = DEPOSIT_MAX_AMOUNT
    withdrawal_min_amount: int = WITHDRAWAL_MIN_AMOUNT
    withdrawal_max_amount: int = WITHDRAWAL_MAX_AMOUNT
    amount_rounding_mode: str = "automatic"
    amount_rounding_percentages: dict[int, float] = field(default_factory=dict)
    date_column_mode: str = "single"
    first_date_description: str = "Opening Balance"
    last_date_description: str = "Balance C/F"
    closing_row_mode: str = "description_only"
    statement_row_mode: str = "auto"
    statement_row_count: int | None = None
    transaction_count_mode: str = "auto"
    monthly_transaction_counts: dict[tuple[int, int], int] = field(default_factory=dict)
    deposit_names: list[str] = field(default_factory=list)
    withdrawal_names: list[str] = field(default_factory=list)
    deposit_name_mode: str = "label_plus_name"
    withdrawal_name_mode: str = "label_plus_name"
    description_extra_text: str = ""
    holiday_dates: set[date] = field(default_factory=set)
    quarter_date_overrides: dict[tuple[int, int], date] = field(default_factory=dict)
    seed: int | None = None


@dataclass(slots=True)
class PlannedEvent:
    event_type: EventType
    date: date
    amount: float
    description: str = ""
    cheque_no: str = ""
    sequence: int = 0


@dataclass(slots=True)
class StatementRow:
    date: date
    description: str
    cheque_no: str
    debit: float
    credit: float
    balance: float
    category: str
    is_system: bool


@dataclass(slots=True)
class StatementSummary:
    total_deposits: float = 0.0
    total_withdrawals: float = 0.0
    total_interest: float = 0.0
    total_tax: float = 0.0
    deposit_count: int = 0
    withdrawal_count: int = 0


@dataclass(slots=True)
class StatementResult:
    rows: list[StatementRow]
    summary: StatementSummary
    events: list[PlannedEvent]
    final_balance: float
    opening_business_date: date
    ending_business_date: date
    last_transaction_date: date
    issue_date: date
    seed: int
    seed_label: str = ""
    is_manual_edit: bool = False


def _round_half_up(value: float, digits: int) -> float:
    quantizer = Decimal("1").scaleb(-digits)
    return float(Decimal(str(value)).quantize(quantizer, rounding=ROUND_HALF_UP))


def _uses_closing_description_row(config: StatementConfig) -> bool:
    return str(config.closing_row_mode or "description_only").strip().lower() != "transaction_allowed"


def _description_with_optional_cheque(description: str, cheque_text: str, include_cheque_column: bool) -> str:
    normalized = description.strip()
    if include_cheque_column or not cheque_text:
        return normalized
    lowered = normalized.lower()
    if cheque_text in normalized and ("chq" in lowered or "cheque" in lowered):
        return normalized
    if normalized.startswith(cheque_text):
        return normalized
    return f"{normalized} CHQ. No. {cheque_text}".strip()


def _normalized_text(value: str) -> str:
    return " ".join(str(value or "").casefold().split())


def _description_signal_flags(config: StatementConfig, description: str) -> dict[str, bool]:
    normalized = _normalized_text(description)
    if not normalized:
        return {"deposit": False, "withdrawal": False, "interest": False, "tax": False}

    def contains(*keywords: str) -> bool:
        for keyword in keywords:
            candidate = _normalized_text(keyword)
            if candidate and candidate in normalized:
                return True
        return False

    return {
        "deposit": contains(config.deposit_text, "deposit"),
        "withdrawal": contains(config.withdrawal_text, "withdrawal", "withdraw", "cheque withdrawal", "chq"),
        "interest": contains(config.interest_text, "interest"),
        "tax": contains(config.tax_text, "tax", "tds"),
    }


def _description_validation_messages(
    config: StatementConfig,
    category: str,
    description: str,
    debit: float,
    credit: float,
) -> list[tuple[str, list[str]]]:
    normalized = description.strip()
    if not normalized:
        return []
    flags = _description_signal_flags(config, normalized)
    messages: list[tuple[str, list[str]]] = []
    if category == "interest":
        if debit > 0 or credit <= 0:
            messages.append(("Interest should be posted in the credit column only.", ["debit", "credit"]))
        if not flags["interest"]:
            messages.append(("Interest row description should match the configured interest text.", ["description"]))
    elif category == "tax":
        if credit > 0 or debit <= 0:
            messages.append(("Tax should be posted in the debit column only.", ["debit", "credit"]))
        if not flags["tax"]:
            messages.append(("Tax row description should match the configured tax text.", ["description"]))
    elif debit > 0 and credit <= 0:
        if flags["deposit"]:
            messages.append(("This debit row is showing a deposit description.", ["description", "debit"]))
        if flags["interest"] or flags["tax"]:
            messages.append(("This debit row is showing an interest or tax description.", ["description", "debit"]))
    elif credit > 0 and debit <= 0:
        if flags["withdrawal"]:
            messages.append(("This credit row is showing a withdrawal description.", ["description", "credit"]))
        if flags["interest"] or flags["tax"]:
            messages.append(("This credit row is showing an interest or tax description.", ["description", "credit"]))
    return messages


def _effective_edited_category(
    config: StatementConfig,
    category: str,
    description: str,
    debit: float,
    credit: float,
    index: int,
    last_index: int,
    date_text: str,
    posting_dates: set[str],
) -> str:
    normalized_category = category.strip().lower()
    flags = _description_signal_flags(config, description)
    on_posting_date = date_text in posting_dates

    if index == 0 and (normalized_category == "opening" or (debit <= 0 and credit <= 0)):
        return "opening"
    if index == last_index and normalized_category == "closing" and debit <= 0 and credit <= 0:
        return "closing"

    if normalized_category in {"deposit", "withdrawal"} or flags["deposit"] or flags["withdrawal"]:
        return "deposit" if credit > 0 and debit <= 0 else "withdrawal"

    # Imported statements often do not carry our internal category metadata.
    # On a posting date, a credit amount is an interest posting and a debit
    # amount is a tax posting; validate those rows as system rows instead of
    # ordinary blocked-date transactions.
    if on_posting_date and normalized_category not in {"deposit", "withdrawal"} and not flags["deposit"] and not flags["withdrawal"] and credit > 0 and debit <= 0:
        return "interest"
    if on_posting_date and normalized_category not in {"deposit", "withdrawal"} and not flags["deposit"] and not flags["withdrawal"] and debit > 0 and credit <= 0:
        return "tax"
    if flags["interest"] and credit > 0 and debit <= 0:
        return "interest"
    if flags["tax"] and debit > 0 and credit <= 0:
        return "tax"
    if normalized_category in {"opening", "interest", "tax", "closing", "deposit", "withdrawal"}:
        return normalized_category
    if credit > 0 and debit <= 0:
        return "deposit"
    if debit > 0 and credit <= 0:
        return "withdrawal"
    return normalized_category


def _normalized_manual_description(config: StatementConfig, event_type: EventType, description: str) -> str:
    normalized = description.strip()
    if not normalized:
        return ""
    flags = _description_signal_flags(config, normalized)
    if event_type == "deposit" and (flags["withdrawal"] or flags["interest"] or flags["tax"]):
        return ""
    if event_type == "withdrawal" and (flags["deposit"] or flags["interest"] or flags["tax"]):
        return ""
    return normalized

def _quarter_actual_date(year: int, month: int, overrides: dict[tuple[int, int], date] | None = None) -> date:
    override_date = (overrides or {}).get((year, month))
    if override_date is not None:
        return override_date
    return date(year, month, QUARTER_DAY_OVERRIDES.get((year, month), QUARTER_DEFAULT_DAYS[month]))

def posting_date_for_period(year: int, month: int, overrides: dict[tuple[int, int], date] | None = None) -> date:
    if month not in QUARTER_DEFAULT_DAYS:
        raise ValueError("Interest and tax dates can only be set for quarter months.")
    return _quarter_actual_date(year, month, overrides)


def _quarter_candidates(start: date, end: date, overrides: dict[tuple[int, int], date] | None = None) -> list[date]:
    if start > end:
        return []
    candidates: list[date] = []
    for year in range(start.year - 1, end.year + 2):
        for month in (1, 4, 7, 10):
            candidate = _quarter_actual_date(year, month, overrides)
            if start <= candidate <= end:
                candidates.append(candidate)
    return sorted(set(candidates))


def _previous_quarter_date(day_value: date, overrides: dict[tuple[int, int], date] | None = None) -> date | None:
    search_start = day_value - timedelta(days=400)
    candidates = [candidate for candidate in _quarter_candidates(search_start, day_value, overrides) if candidate < day_value]
    return candidates[-1] if candidates else None


def build_quarter_schedule(
    start: date,
    end: date,
    holidays: set[date],
    overrides: dict[tuple[int, int], date] | None = None,
) -> list[tuple[date, date]]:
    del holidays
    return [(actual_date, actual_date) for actual_date in _quarter_candidates(start, end, overrides)]


def _days_in_scope(
    config: StatementConfig,
    reserved_days: set[date],
    window_start: date | None = None,
    window_end: date | None = None,
) -> dict[tuple[int, int], list[date]]:
    monthly_days: dict[tuple[int, int], list[date]] = {}
    start_bound = max(config.start_date, window_start or config.start_date)
    end_bound = min(config.end_date, window_end or config.end_date)
    current = start_bound
    while current <= end_bound:
        if current not in reserved_days and is_business_day(current, config.holiday_dates):
            monthly_days.setdefault((current.year, current.month), []).append(current)
        current += timedelta(days=1)
    return monthly_days


def _allocate_weighted_counts(
    capacities: list[int],
    total_needed: int,
    rng: random.Random,
    minimums: list[int] | None = None,
) -> list[int]:
    counts = list(minimums or [0] * len(capacities))
    remaining = total_needed - sum(counts)
    if remaining < 0:
        raise ValueError("Minimum allocation exceeds total.")
    if remaining == 0:
        return counts

    base_weights = [0.85 + rng.random() * 1.15 for _ in capacities]
    guard = 0
    while remaining > 0 and guard < 50_000:
        eligible = [index for index, capacity in enumerate(capacities) if counts[index] < capacity]
        if not eligible:
            raise ValueError("Not enough capacity to allocate requested total.")
        weights: list[float] = []
        for index in eligible:
            headroom = capacities[index] - counts[index]
            weight = base_weights[index] * (0.9 + rng.random() * 0.35) * (1.0 + headroom * 0.12)
            weight /= 1.0 + (counts[index] * 0.45)
            weights.append(weight)
        chosen = rng.choices(eligible, weights=weights, k=1)[0]
        counts[chosen] += 1
        remaining -= 1
        guard += 1
    if remaining > 0:
        raise ValueError("Could not complete weighted allocation.")
    return counts


def _pick_date(
    available: list[date],
    preference: str,
    used_day_numbers: set[int],
    rng: random.Random,
) -> date:
    if not available:
        raise ValueError("No available business dates to choose from.")
    target = {"early": 0.24, "middle": 0.52, "late": 0.78}.get(preference, 0.5)
    scored: list[tuple[float, date]] = []
    length = max(len(available) - 1, 1)
    for index, day_value in enumerate(available):
        position = index / length
        score = abs(position - target)
        if day_value.day in used_day_numbers:
            score += 0.55
        score += rng.random() * 0.10
        scored.append((score, day_value))
    scored.sort(key=lambda item: item[0])
    top_choices = [day_value for _, day_value in scored[: min(5, len(scored))]]
    chosen = rng.choice(top_choices)
    available.remove(chosen)
    used_day_numbers.add(chosen.day)
    return chosen


def _estimate_net_interest(
    opening_balance: float,
    target_closing_balance: float,
    annual_rate: float,
    total_days: int,
) -> float:
    average_balance = max(0.0, (opening_balance + target_closing_balance) / 2.0)
    gross = average_balance * (annual_rate / 100.0) * (total_days / 365.0)
    return round_money(gross * 0.94)


AMOUNT_STEPS_BY_MODE = {
    "round_5": (5,),
    "round_10": (10,),
    "round_50": (50,),
    "round_100": (100,),
    "round_500": (500,),
    "round_1000": (1_000,),
    "round_1000_500": (1_000, 500),
    "round_1000_500_100": (1_000, 500, 100),
    "round_1000_500_100_50": (1_000, 500, 100, 50),
    "round_1000_500_100_50_10": (1_000, 500, 100, 50, 10),
    "round_1000_500_100_50_10_5": (1_000, 500, 100, 50, 10, 5),
}


def _normalize_amount_mode(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in AMOUNT_STEPS_BY_MODE or normalized == "custom":
        return normalized
    return "automatic"


def _amount_step_for_mode(mode: str) -> int:
    normalized = _normalize_amount_mode(mode)
    return min(AMOUNT_STEPS_BY_MODE.get(normalized, (100,)))


def _amount_range(config: StatementConfig, event_type: EventType) -> tuple[int, int]:
    mode = _normalize_amount_mode(config.amount_rounding_mode)
    if event_type == "deposit":
        minimum = int(config.deposit_min_amount or DEPOSIT_MIN_AMOUNT)
        maximum = int(config.deposit_max_amount or DEPOSIT_MAX_AMOUNT)
    else:
        minimum = int(config.withdrawal_min_amount or WITHDRAWAL_MIN_AMOUNT)
        maximum = int(config.withdrawal_max_amount or WITHDRAWAL_MAX_AMOUNT)
    step = 5 if mode in {"automatic", "custom"} else _amount_step_for_mode(mode)
    safe_min = ((max(1, minimum) + step - 1) // step) * step
    safe_max = (max(1, maximum) // step) * step
    if safe_min > safe_max:
        label = "deposit" if event_type == "deposit" else "withdrawal"
        raise ValueError(f"{label.title()} amount range must contain at least one amount for the selected rounding type.")
    return safe_min, safe_max


def _amount_bands(minimum: int, maximum: int) -> tuple[int, int, int]:
    if maximum <= minimum:
        return minimum, minimum, minimum
    span = maximum - minimum
    low_max = minimum + max(0, span // 3)
    mid_max = minimum + max(0, (span * 2) // 3)
    high_min = min(maximum, mid_max + _amount_step_for_mode("automatic"))
    return max(minimum, low_max), max(minimum, mid_max), max(minimum, high_min)


def _bounded_total_target(target: int, count: int, minimum: int, maximum: int, mode: str) -> int:
    if count <= 0:
        return 0
    lower = count * minimum
    upper = count * maximum
    bounded = max(lower, min(upper, target))
    step = _amount_step_for_mode(mode)
    rounded = round_to_step(bounded, step)
    if rounded < lower:
        rounded = ((lower + step - 1) // step) * step
    if rounded > upper:
        rounded = (upper // step) * step
    return max(lower, min(upper, rounded))


def _random_step(rng: random.Random, mode: str = "automatic") -> int:
    normalized = _normalize_amount_mode(mode)
    if normalized != "automatic":
        return rng.choice(AMOUNT_STEPS_BY_MODE[normalized])
    roll = rng.random()
    if roll < 0.08:
        return 100
    if roll < 0.56:
        return 500
    return 1_000


def _random_styled_amount(minimum: int, maximum: int, rng: random.Random, forced_step: int | None = None, mode: str = "automatic") -> int:
    normalized = _normalize_amount_mode(mode)
    step = forced_step if normalized == "automatic" and forced_step else _random_step(rng, normalized)
    safe_min = ((minimum + step - 1) // step) * step
    safe_max = (maximum // step) * step
    if safe_max <= safe_min:
        return safe_min
    candidates = [value for value in range(safe_min, safe_max + step, step)]
    if step == 100:
        non_five_hundred = [value for value in candidates if value % 500 != 0]
        if non_five_hundred:
            candidates = non_five_hundred
    return rng.choice(candidates)


def _distribute_total(
    total_amount: int,
    count: int,
    preferred_min: int,
    preferred_max: int,
    hard_min: int,
    hard_max: int,
    rng: random.Random,
    mode: str = "automatic",
) -> list[int]:
    if count <= 0:
        return []
    step = _amount_step_for_mode(mode)
    average = total_amount / count
    soft_min = max(hard_min, min(preferred_min, round_to_step(average * 0.7, step) or preferred_min))
    derived_soft_max = max(preferred_max, round_to_step(average * 1.35, step))
    soft_max = max(soft_min, min(hard_max, derived_soft_max))
    amounts: list[int] = []
    for _ in range(count):
        randomized = average * (0.75 + rng.random() * 0.53)
        bounded = max(soft_min, min(soft_max, round_to_step(randomized, step)))
        amounts.append(max(hard_min, min(hard_max, bounded)))

    difference = round_to_step(total_amount - sum(amounts), step)
    guard = 0
    while difference != 0 and guard < 20_000:
        index = guard % len(amounts)
        delta_step = step if difference > 0 else -step
        next_value = amounts[index] + delta_step
        if hard_min <= next_value <= hard_max:
            amounts[index] = next_value
            difference -= delta_step
        guard += 1
    return [max(hard_min, min(hard_max, round_to_step(value, step))) for value in amounts]


def _rebalance_amounts_to_total(
    amounts: list[int],
    target_total: int,
    minimum: int,
    maximum: int,
    rng: random.Random,
    priority_order: list[int] | None = None,
    mode: str = "automatic",
) -> list[int]:
    step = _amount_step_for_mode(mode)
    effective_max = maximum
    balanced = [max(minimum, min(effective_max, round_to_step(value, step))) for value in amounts]
    difference = round_to_step(target_total - sum(balanced), step)
    guard = 0
    order = list(priority_order or list(range(len(balanced))))
    while difference != 0 and guard < 20_000:
        rng.shuffle(order)
        direction = 1 if difference > 0 else -1
        abs_difference = abs(difference)
        step_options = [
            candidate
            for candidate in (1_000, 500, 100, 50, 10, 5)
            if candidate >= step and candidate <= abs_difference and candidate % step == 0
        ]
        if not step_options:
            break

        counts = Counter(balanced)
        candidates: list[tuple[float, float, int, int]] = []
        for index in order:
            current_value = balanced[index]
            for step_size in step_options:
                next_value = current_value + (direction * step_size)
                if not (minimum <= next_value <= effective_max):
                    continue
                score = 0.0
                if step_size == 100:
                    score += 1.15
                if counts[next_value] >= 1 and next_value != current_value:
                    score += 1.5
                if counts[next_value] >= 2 and next_value != current_value:
                    score += 8.0
                if direction > 0 and next_value >= effective_max - 1_000:
                    score += 1.1
                if direction < 0 and next_value <= minimum + 1_000:
                    score += 1.1
                if counts[current_value] > 1:
                    score -= 0.5
                candidates.append((score, rng.random(), index, step_size))

        if not candidates:
            break

        candidates.sort(key=lambda item: (item[0], item[1]))
        best_score = candidates[0][0]
        top_choices = [item for item in candidates if item[0] <= best_score + 0.35][:6]
        _score, _randomizer, chosen_index, chosen_step = rng.choice(top_choices)
        balanced[chosen_index] += direction * chosen_step
        difference -= direction * chosen_step
        guard += 1
    return balanced


def _limit_duplicate_amounts(
    amounts: list[int],
    minimum: int,
    maximum: int,
    rng: random.Random,
    mode: str = "automatic",
) -> list[int]:
    if not amounts:
        return []
    normalized_mode = _normalize_amount_mode(mode)
    step = _amount_step_for_mode(normalized_mode)
    effective_max = maximum
    adjusted = list(amounts)
    guard = 0
    while guard < 5_000:
        counts = Counter(adjusted)
        duplicate_values = [value for value, count in counts.items() if count > 1]
        overflow_value = next((value for value in duplicate_values if counts[value] > 2), None)
        if overflow_value is None and len(duplicate_values) <= 2:
            return adjusted

        if overflow_value is not None:
            candidate_index = next(index for index, value in enumerate(adjusted) if value == overflow_value and counts[value] > 2)
        else:
            duplicate_values.sort(key=lambda value: (counts[value], value), reverse=True)
            preserve = set(duplicate_values[:2])
            candidate_index = next(index for index, value in enumerate(adjusted) if value not in preserve and counts[value] > 1)

        current_value = adjusted[candidate_index]
        replacement = None
        for step_size in (1_000, 500, 100):
            if step_size < step or step_size % step != 0:
                continue
            offsets = [step_size, -step_size, step_size * 2, -(step_size * 2)]
            rng.shuffle(offsets)
            for offset in offsets:
                next_value = current_value + offset
                if not (minimum <= next_value <= effective_max):
                    continue
                if normalized_mode == "automatic" and step_size == 100 and next_value % 500 == 0:
                    continue
                if counts[next_value] >= 2:
                    continue
                if counts[next_value] >= 1 and next_value not in duplicate_values[:2]:
                    continue
                replacement = next_value
                break
            if replacement is not None:
                break

        if replacement is None:
            guard += 1
            continue
        adjusted[candidate_index] = replacement
        guard += 1
    return adjusted


def _normalize_hundred_only_ratio(
    amounts: list[int],
    target_total: int,
    minimum: int,
    maximum: int,
    rng: random.Random,
) -> list[int]:
    if not amounts:
        return []

    effective_max = max(minimum, min(maximum, maximum - 1_000))
    adjusted = list(amounts)
    min_hundred_only = max(1, int(len(adjusted) * 0.10))
    max_hundred_only = max(min_hundred_only, int(len(adjusted) * 0.25))

    def hundred_only_indices() -> list[int]:
        return [index for index, value in enumerate(adjusted) if value % 500 != 0]

    for _ in range(4):
        hundred_indices = hundred_only_indices()
        while len(hundred_indices) > max_hundred_only:
            index = rng.choice(hundred_indices)
            current_value = adjusted[index]
            candidates = []
            for step_size in (500, 1_000):
                rounded = int(round(current_value / step_size) * step_size)
                if minimum <= rounded <= effective_max and rounded != current_value:
                    candidates.append(rounded)
            if not candidates:
                break
            adjusted[index] = min(candidates, key=lambda value: abs(value - current_value))
            hundred_indices = hundred_only_indices()

        hundred_indices = hundred_only_indices()
        while len(hundred_indices) < min_hundred_only:
            rounded_indices = [index for index, value in enumerate(adjusted) if value % 500 == 0]
            if not rounded_indices:
                break
            index = rng.choice(rounded_indices)
            current_value = adjusted[index]
            offsets = [100, 200, 300, 400, -100, -200, -300, -400]
            rng.shuffle(offsets)
            replacement = None
            for offset in offsets:
                next_value = current_value + offset
                if not (minimum <= next_value <= effective_max):
                    continue
                if next_value % 500 == 0:
                    continue
                replacement = next_value
                break
            if replacement is None:
                break
            adjusted[index] = replacement
            hundred_indices = hundred_only_indices()

        adjusted = _rebalance_amounts_to_total(adjusted, target_total, minimum, maximum, rng)
        adjusted = _limit_duplicate_amounts(adjusted, minimum, maximum, rng)

    return adjusted


def _ensure_low_band_amount(
    amounts: list[int],
    target_total: int,
    minimum: int,
    low_threshold: int,
    maximum: int,
    rng: random.Random,
    mode: str = "automatic",
) -> list[int]:
    if not amounts or any(value <= low_threshold for value in amounts):
        return amounts
    adjusted = list(amounts)
    smallest_index = min(range(len(adjusted)), key=lambda index: adjusted[index])
    low_value = _random_styled_amount(minimum, low_threshold, rng, mode=mode)
    adjusted[smallest_index] = low_value
    adjusted = _rebalance_amounts_to_total(adjusted, target_total, minimum, maximum, rng, mode=mode)
    adjusted = _limit_duplicate_amounts(adjusted, minimum, maximum, rng, mode=mode)
    if _normalize_amount_mode(mode) == "automatic":
        adjusted = _normalize_hundred_only_ratio(adjusted, target_total, minimum, maximum, rng)
    return adjusted


def _apply_natural_amount_pattern(
    base_amounts: list[int],
    target_total: int,
    minimum: int,
    maximum: int,
    low_max: int,
    mid_max: int,
    high_band_min: int,
    rng: random.Random,
    mode: str = "automatic",
) -> list[int]:
    if not base_amounts:
        return []
    step = _amount_step_for_mode(mode)
    effective_max = maximum
    effective_high_band_min = min(effective_max, high_band_min)
    styled = [max(minimum, min(effective_max, round_to_step(value, step))) for value in base_amounts]
    total_count = len(styled)

    low_count = min(total_count, rng.randint(min(2, total_count), min(3, total_count)))
    indices = list(range(total_count))
    rng.shuffle(indices)
    low_indices = indices[:low_count]
    remaining = [index for index in indices if index not in low_indices]
    if total_count >= 3 and remaining:
        mid_count = max(1, min(len(remaining), rng.randint(1, max(1, len(remaining)))))
    else:
        mid_count = max(0, min(len(remaining), total_count - low_count - 1))
    mid_indices = remaining[:mid_count]
    high_indices = [index for index in range(total_count) if index not in low_indices and index not in mid_indices]
    if not high_indices and total_count > 0:
        fallback_index = total_count - 1
        if fallback_index not in low_indices and fallback_index not in mid_indices:
            high_indices.append(fallback_index)

    for index in low_indices:
        styled[index] = _random_styled_amount(minimum, max(minimum, low_max), rng, mode=mode)
    for index in mid_indices:
        mid_min = min(maximum, low_max + step)
        mid_limit = min(maximum, max(mid_min, mid_max))
        styled[index] = _random_styled_amount(mid_min, mid_limit, rng, mode=mode)
    for index in high_indices:
        high_min = min(effective_max, max(mid_max + step, effective_high_band_min))
        styled[index] = _random_styled_amount(high_min, effective_max, rng, forced_step=500 if rng.random() < 0.5 else None, mode=mode)

    return _rebalance_amounts_to_total(styled, target_total, minimum, maximum, rng, mode=mode)


def _order_amounts_with_spacing(
    amounts: list[int],
    rng: random.Random,
    min_gap: int,
    window: int = 2,
) -> list[int]:
    remaining = list(amounts)
    ordered: list[int] = []
    while remaining:
        recent = ordered[-window:]
        scored: list[tuple[float, float, int, int]] = []
        for index, value in enumerate(remaining):
            penalty = 0.0
            for previous in recent:
                if abs(value - previous) < min_gap:
                    penalty += 1.0
                if value == previous:
                    penalty += 1.0
            scored.append((penalty, rng.random(), index, value))
        scored.sort(key=lambda item: (item[0], item[1]))
        best_penalty = scored[0][0]
        top_choices = [item for item in scored if item[0] <= best_penalty + 0.5][:4]
        chosen = rng.choice(top_choices)
        ordered.append(chosen[3])
        remaining.pop(chosen[2])
    return ordered


def _description_for_event(event: PlannedEvent, config: StatementConfig, rng: random.Random) -> str:
    if event.description.strip():
        return event.description.strip()
    if event.event_type == "deposit":
        base = config.deposit_text.strip() or "Cash Deposit"
        names = config.deposit_names
        mode = config.deposit_name_mode
    else:
        base = config.withdrawal_text.strip() or "Cheque Withdrawal"
        names = config.withdrawal_names
        mode = config.withdrawal_name_mode

    name = rng.choice(names) if names else ""
    extra = config.description_extra_text.strip()

    def join_parts(parts: list[str]) -> str:
        return " ".join(part for part in parts if part.strip()).strip()

    if mode == "name_plus_label":
        return join_parts([name, base]) or base
    if mode == "name_only":
        return name or base
    if mode == "label_only":
        return base
    if mode == "extra_only":
        return extra or base
    if mode == "label_extra_name":
        return join_parts([base, extra, name]) or base
    if mode == "label_name_extra":
        return join_parts([base, name, extra]) or base
    if mode == "name_label_extra":
        return join_parts([name, base, extra]) or base
    if mode == "name_extra_label":
        return join_parts([name, extra, base]) or base
    if mode == "extra_label_name":
        return join_parts([extra, base, name]) or base
    if mode == "extra_name_label":
        return join_parts([extra, name, base]) or base
    if not name:
        return base
    return f"{base} by {name}"


def _count_runs(sequence: list[EventType], event_type: EventType, length: int) -> int:
    total = 0
    current = 0
    for item in sequence:
        if item == event_type:
            current += 1
        else:
            if current == length:
                total += 1
            current = 0
    if current == length:
        total += 1
    return total


def _max_run_length(sequence: list[EventType], event_type: EventType) -> int:
    longest = 0
    current = 0
    for item in sequence:
        if item == event_type:
            current += 1
            longest = max(longest, current)
        else:
            current = 0
    return longest


def _ratio_distance(actual: float, target: float) -> float:
    return abs(actual - target)


def _resequence_transaction_types(planned: list[PlannedEvent], rng: random.Random) -> None:
    deposit_total = sum(1 for event in planned if event.event_type == "deposit")
    withdrawal_total = len(planned) - deposit_total
    total_slots = len(planned)
    if total_slots <= 1:
        return

    layouts: list[dict[str, object]] = []
    max_withdrawal_pairs = min(3, withdrawal_total // 2)
    for withdrawal_pair_runs in range(1, max_withdrawal_pairs + 1):
        withdrawal_runs = withdrawal_total - withdrawal_pair_runs
        if withdrawal_runs <= 0:
            continue
        withdrawal_single_runs = withdrawal_runs - withdrawal_pair_runs
        if withdrawal_single_runs < 1:
            continue

        for start_type, end_type in (
            ("deposit", "deposit"),
            ("deposit", "withdrawal"),
            ("withdrawal", "deposit"),
            ("withdrawal", "withdrawal"),
        ):
            deposit_runs = withdrawal_runs
            if start_type == "deposit":
                deposit_runs += 1
            if end_type == "withdrawal":
                deposit_runs -= 1
            if deposit_runs <= 0:
                continue

            for deposit_triple_runs in range(0, min(deposit_total // 3, deposit_runs) + 1):
                deposit_single_runs = (2 * deposit_runs) - deposit_total + deposit_triple_runs
                deposit_double_runs = deposit_total - deposit_runs - (2 * deposit_triple_runs)
                if deposit_single_runs < 0 or deposit_double_runs < 0:
                    continue
                if deposit_single_runs + deposit_double_runs + deposit_triple_runs != deposit_runs:
                    continue
                if deposit_triple_runs > 0 and deposit_runs < 2:
                    continue
                if deposit_single_runs == 0 and deposit_triple_runs == 0 and deposit_runs > 1:
                    continue

                weight = 1.0
                if start_type == "deposit":
                    weight *= 1.15
                if end_type == "deposit":
                    weight *= 1.08
                if deposit_triple_runs == 1:
                    weight *= 1.10
                elif deposit_triple_runs == 2:
                    weight *= 0.92
                if deposit_single_runs > 0:
                    weight *= 1.10
                if withdrawal_pair_runs == 1:
                    weight *= 1.10
                elif withdrawal_pair_runs == 2:
                    weight *= 1.02
                elif withdrawal_pair_runs == 3:
                    weight *= 0.90

                layouts.append(
                    {
                        "start_type": start_type,
                        "end_type": end_type,
                        "deposit_runs": deposit_runs,
                        "withdrawal_runs": withdrawal_runs,
                        "deposit_single_runs": deposit_single_runs,
                        "deposit_double_runs": deposit_double_runs,
                        "deposit_triple_runs": deposit_triple_runs,
                        "withdrawal_pair_runs": withdrawal_pair_runs,
                        "withdrawal_single_runs": withdrawal_single_runs,
                        "weight": weight,
                    }
                )

    if not layouts:
        raise ValueError("The transaction counts cannot fit both single and consecutive debit runs.")

    scored_layouts: list[dict[str, object]] = []
    for item in layouts:
        deposit_single_event_ratio = int(item["deposit_single_runs"]) / max(1, deposit_total)
        deposit_double_event_ratio = (2 * int(item["deposit_double_runs"])) / max(1, deposit_total)
        deposit_triple_event_ratio = (3 * int(item["deposit_triple_runs"])) / max(1, deposit_total)
        withdrawal_double_event_ratio = (2 * int(item["withdrawal_pair_runs"])) / max(1, withdrawal_total)

        score = 0.0
        score += _ratio_distance(deposit_single_event_ratio, 0.20) * 2.6
        score += _ratio_distance(deposit_double_event_ratio, 0.60) * 3.0
        score += _ratio_distance(deposit_triple_event_ratio, 0.20) * 2.6
        score += _ratio_distance(withdrawal_double_event_ratio, 0.30) * 2.7

        if int(item["deposit_single_runs"]) == 0:
            score += 0.7
        if int(item["deposit_triple_runs"]) == 0 and deposit_total >= 9:
            score += 0.45
        if int(item["withdrawal_pair_runs"]) == 0 and withdrawal_total >= 6:
            score += 0.25

        scored = dict(item)
        scored["score"] = score
        scored_layouts.append(scored)

    best_withdrawal_pair_score = min(
        _ratio_distance((2 * int(item["withdrawal_pair_runs"])) / max(1, withdrawal_total), 0.30)
        for item in scored_layouts
    )
    scored_layouts = [
        item
        for item in scored_layouts
        if _ratio_distance((2 * int(item["withdrawal_pair_runs"])) / max(1, withdrawal_total), 0.30)
        <= best_withdrawal_pair_score + 0.03
    ]

    best_score = min(float(item["score"]) for item in scored_layouts)
    layouts = [item for item in scored_layouts if float(item["score"]) <= best_score + 0.22]

    chosen_layout = rng.choices(
        layouts,
        weights=[float(item["weight"]) / (1.0 + (float(item["score"]) * 3.0)) for item in layouts],
        k=1,
    )[0]
    start_type = str(chosen_layout["start_type"])
    end_type = str(chosen_layout["end_type"])
    deposit_runs = int(chosen_layout["deposit_runs"])
    withdrawal_runs = int(chosen_layout["withdrawal_runs"])
    deposit_single_runs = int(chosen_layout["deposit_single_runs"])
    deposit_double_runs = int(chosen_layout["deposit_double_runs"])
    deposit_triple_runs = int(chosen_layout["deposit_triple_runs"])
    withdrawal_pair_runs = int(chosen_layout["withdrawal_pair_runs"])
    withdrawal_single_runs = int(chosen_layout["withdrawal_single_runs"])

    run_types: list[EventType] = []
    current_type: EventType = "deposit" if start_type == "deposit" else "withdrawal"
    total_runs = deposit_runs + withdrawal_runs
    for _ in range(total_runs):
        run_types.append(current_type)
        current_type = "withdrawal" if current_type == "deposit" else "deposit"
    if run_types[-1] != end_type:
        raise ValueError("Transaction run layout ended with an unexpected event type.")

    deposit_run_positions = [index for index, item in enumerate(run_types) if item == "deposit"]
    withdrawal_run_positions = [index for index, item in enumerate(run_types) if item == "withdrawal"]

    if len(deposit_run_positions) != deposit_runs or len(withdrawal_run_positions) != withdrawal_runs:
        raise ValueError("Transaction run counts do not match the selected layout.")

    run_lengths = [1] * total_runs

    if deposit_triple_runs > 0:
        candidate_positions = deposit_run_positions[:-1] if len(deposit_run_positions) > deposit_triple_runs else deposit_run_positions[:]
        middle_left = max(0, len(deposit_run_positions) // 4)
        middle_right = max(middle_left + 1, len(deposit_run_positions) - middle_left)
        preferred = candidate_positions[middle_left:middle_right]
        triple_pool = preferred if len(preferred) >= deposit_triple_runs else candidate_positions
        triple_positions = rng.sample(triple_pool, deposit_triple_runs)
    else:
        triple_positions = []
    for position in triple_positions:
        run_lengths[position] = 3

    remaining_deposit_positions = [position for position in deposit_run_positions if position not in triple_positions]
    single_positions: list[int] = []
    if deposit_single_runs > 0:
        if len(remaining_deposit_positions) < deposit_single_runs:
            raise ValueError("Not enough deposit run positions to place single deposit runs.")
        preferred_single_positions = [position for position in remaining_deposit_positions if position not in triple_positions]
        single_positions = rng.sample(preferred_single_positions, deposit_single_runs)
    for position in single_positions:
        run_lengths[position] = 1

    for position in remaining_deposit_positions:
        if position not in single_positions:
            run_lengths[position] = 2

    pair_positions: list[int] = []
    if withdrawal_pair_runs > 0:
        pair_positions = rng.sample(withdrawal_run_positions, withdrawal_pair_runs)
    for position in pair_positions:
        run_lengths[position] = 2
    for position in withdrawal_run_positions:
        if position not in pair_positions:
            run_lengths[position] = 1

    sequence: list[EventType] = []
    for run_type, run_length in zip(run_types, run_lengths):
        sequence.extend([run_type] * run_length)

    if len(sequence) != total_slots:
        raise ValueError("Transaction run expansion did not produce the expected number of events.")
    if sequence.count("deposit") != deposit_total or sequence.count("withdrawal") != withdrawal_total:
        raise ValueError("Transaction run expansion changed the deposit or withdrawal counts.")
    if _max_run_length(sequence, "deposit") > 3:
        raise ValueError("Transaction run expansion created a deposit streak longer than three.")
    if _max_run_length(sequence, "withdrawal") > 2:
        raise ValueError("Transaction run expansion created a withdrawal streak longer than two.")
    if _count_runs(sequence, "withdrawal", 2) > 3:
        raise ValueError("Transaction run expansion created too many double-withdrawal runs.")

    for event, new_type in zip(planned, sequence):
        event.event_type = new_type


def _plan_transaction_counts(
    monthly_days: dict[tuple[int, int], list[date]],
    system_rows: int,
    target_statement_rows: int | None,
    rng: random.Random,
    monthly_targets: dict[tuple[int, int], int] | None = None,
) -> tuple[list[tuple[tuple[int, int], list[date]]], list[int], list[int], list[int], int]:
    month_items = [(month_key, days) for month_key, days in sorted(monthly_days.items()) if len(days) >= 2]
    if not month_items:
        raise ValueError("No month in the selected period has enough business days for transactions.")

    custom_targets = {key: max(0, int(value)) for key, value in (monthly_targets or {}).items() if int(value or 0) > 0}
    if custom_targets:
        available = {month_key: days for month_key, days in month_items}
        month_items = [(month_key, available[month_key]) for month_key in sorted(custom_targets) if month_key in available]
        if not month_items:
            raise ValueError("Customized transaction counts do not match any month in the selected statement period.")

    month_count = len(month_items)
    high_density = bool(custom_targets) or target_statement_rows is not None
    default_cap = max(4, (13 + month_count - 1) // month_count) if month_count <= 18 else DEFAULT_MONTHLY_TRANSACTION_CAP
    monthly_cap = CUSTOM_MONTHLY_TRANSACTION_CAP if high_density else default_cap
    capacities = [min(monthly_cap, len(days)) for _, days in month_items]
    max_user_rows = min(MAX_STATEMENT_ROWS - system_rows, sum(capacities))
    min_user_rows = min(max_user_rows, max(DEFAULT_MIN_STATEMENT_ROWS - system_rows, month_count))
    if month_count >= 6:
        min_user_rows = min(max_user_rows, max(min_user_rows, month_count * 2))
    if custom_targets:
        monthly_totals = [custom_targets[month_key] for month_key, _days in month_items]
        desired_total = sum(monthly_totals)
        if desired_total <= 0:
            raise ValueError("Enter at least one customized monthly transaction count.")
        if desired_total > max_user_rows:
            raise ValueError("Customized monthly transaction counts are too high for the selected statement format.")
        for index, total in enumerate(monthly_totals):
            if total > capacities[index]:
                raise ValueError(f"{month_items[index][0][0]}-{month_items[index][0][1]:02d} cannot fit {total} transactions.")
    elif target_statement_rows is not None:
        desired_total = target_statement_rows - system_rows
        if desired_total < month_count or desired_total > max_user_rows:
            raise ValueError("The selected statement period cannot fit that custom row count.")
        monthly_totals = _allocate_weighted_counts(capacities, desired_total, rng, minimums=[1] * month_count)
    else:
        desired_total = max_user_rows if min_user_rows >= max_user_rows else rng.randint(min_user_rows, max_user_rows)
        monthly_totals = _allocate_weighted_counts(capacities, desired_total, rng, minimums=[1] * month_count)

    # D / C lies in [45%, 70%], with C + D equal to the requested total.
    minimum_debits = max(5, (45 * desired_total + 144) // 145)
    maximum_debits = 70 * desired_total // 170
    if desired_total < 13 or minimum_debits > maximum_debits:
        raise ValueError("At least 13 customer transactions are needed for the debit/credit ratio and amount groups. Increase the transaction count or period.")
    withdrawal_total = rng.randint(minimum_debits, maximum_debits)
    withdrawal_counts = _allocate_weighted_counts(monthly_totals, withdrawal_total, rng)
    deposit_counts = [monthly_totals[index] - withdrawal_counts[index] for index in range(month_count)]
    return month_items, monthly_totals, deposit_counts, withdrawal_counts, desired_total


def _create_transaction_plan(
    config: StatementConfig,
    opening_business_date: date,
    ending_business_date: date,
    quarter_schedule: list[tuple[date, date]],
    rng: random.Random,
) -> tuple[list[PlannedEvent], dict]:
    posting_dates = {posting_date for _, posting_date in quarter_schedule}
    reserved_days = {opening_business_date, *posting_dates}
    if _uses_closing_description_row(config):
        reserved_days.add(ending_business_date)
    monthly_days = _days_in_scope(config, reserved_days)
    system_rows = (2 if _uses_closing_description_row(config) else 1) + (len(quarter_schedule) * 2)
    month_items, _monthly_totals, deposit_counts, withdrawal_counts, _desired_total = _plan_transaction_counts(
        monthly_days,
        system_rows,
        _desired_statement_row_count(config),
        rng,
        config.monthly_transaction_counts if config.transaction_count_mode == "custom" else None,
    )

    mix = prepare_mix(_desired_total, config, rng)
    withdrawal_counts = _allocate_weighted_counts(_monthly_totals, sum(mix["demands"][2:]), rng)
    deposit_counts = [total - withdrawals for total, withdrawals in zip(_monthly_totals, withdrawal_counts)]
    planned: list[PlannedEvent] = []
    used_day_numbers: set[int] = set()
    for index, (_month_key, available_days) in enumerate(month_items):
        working_days = list(available_days)
        for withdrawal_index in range(withdrawal_counts[index]):
            chosen = _pick_date(working_days, "late" if withdrawal_index == 0 else "middle", used_day_numbers, rng)
            planned.append(PlannedEvent("withdrawal", chosen, 0.0))
        for deposit_index in range(deposit_counts[index]):
            chosen = _pick_date(working_days, "early" if deposit_index == 0 else "middle", used_day_numbers, rng)
            planned.append(PlannedEvent("deposit", chosen, 0.0))

    planned.sort(key=lambda item: (item.date, 0 if item.event_type == "withdrawal" else 1))
    _resequence_transaction_types(planned, rng)

    deposits = [event for event in planned if event.event_type == "deposit"]
    withdrawals = [event for event in planned if event.event_type == "withdrawal"]
    amount_mode = "automatic" if config.amount_rounding_mode == "custom" else _normalize_amount_mode(config.amount_rounding_mode)
    deposit_min, deposit_max = _amount_range(config, "deposit")
    withdrawal_min, withdrawal_max = _amount_range(config, "withdrawal")
    deposit_low_max, deposit_mid_max, deposit_high_min = _amount_bands(deposit_min, deposit_max)
    withdrawal_low_max, withdrawal_mid_max, withdrawal_high_min = _amount_bands(withdrawal_min, withdrawal_max)
    total_days = max(1, (ending_business_date - opening_business_date).days + 1)
    estimated_interest = _estimate_net_interest(
        config.opening_balance,
        config.target_closing_balance,
        config.interest_rate,
        total_days,
    )

    withdrawal_amounts: list[int] = []
    if withdrawals:
        average_min = max(withdrawal_min, min(withdrawal_max, 22_000))
        average_max = max(average_min, min(withdrawal_max, 34_000))
        withdrawal_total_target = _bounded_total_target(
            round_to_step(len(withdrawals) * rng.randint(average_min, average_max), _amount_step_for_mode(amount_mode)),
            len(withdrawals),
            withdrawal_min,
            withdrawal_max,
            amount_mode,
        )
        withdrawal_base = _distribute_total(
            withdrawal_total_target,
            len(withdrawals),
            withdrawal_min,
            min(withdrawal_max, max(withdrawal_min, 42_000)),
            withdrawal_min,
            withdrawal_max,
            rng,
            amount_mode,
        )
        withdrawal_amounts = _apply_natural_amount_pattern(
            withdrawal_base,
            withdrawal_total_target,
            withdrawal_min,
            withdrawal_max,
            withdrawal_low_max,
            withdrawal_mid_max,
            withdrawal_high_min,
            rng,
            amount_mode,
        )
        withdrawal_amounts = _limit_duplicate_amounts(withdrawal_amounts, withdrawal_min, withdrawal_max, rng, mode=amount_mode)
        if amount_mode == "automatic":
            withdrawal_amounts = _normalize_hundred_only_ratio(
                withdrawal_amounts,
                withdrawal_total_target,
                withdrawal_min,
                withdrawal_max,
                rng,
            )
        withdrawal_amounts = _order_amounts_with_spacing(withdrawal_amounts, rng, min_gap=max(500, _amount_step_for_mode(amount_mode)))

    deposit_amounts: list[int] = []
    if deposits:
        desired_deposit_total = max(
            round_to_step(config.target_closing_balance - config.opening_balance + sum(withdrawal_amounts) - estimated_interest, _amount_step_for_mode(amount_mode)),
            len(deposits) * deposit_min,
        )
        desired_deposit_total = _bounded_total_target(desired_deposit_total, len(deposits), deposit_min, deposit_max, amount_mode)
        deposit_base = _distribute_total(
            desired_deposit_total,
            len(deposits),
            min(deposit_max, max(deposit_min, 32_000)),
            min(deposit_max, max(deposit_min, 78_000)),
            deposit_min,
            deposit_max,
            rng,
            amount_mode,
        )
        deposit_amounts = _apply_natural_amount_pattern(
            deposit_base,
            desired_deposit_total,
            deposit_min,
            deposit_max,
            deposit_low_max,
            deposit_mid_max,
            deposit_high_min,
            rng,
            amount_mode,
        )
        deposit_amounts = _limit_duplicate_amounts(deposit_amounts, deposit_min, deposit_max, rng, mode=amount_mode)
        if amount_mode == "automatic":
            deposit_amounts = _normalize_hundred_only_ratio(
                deposit_amounts,
                desired_deposit_total,
                deposit_min,
                deposit_max,
                rng,
            )
            deposit_amounts = _ensure_low_band_amount(
                deposit_amounts,
                desired_deposit_total,
                deposit_min,
                min(deposit_max, max(deposit_min, 25_000)),
                deposit_max,
                rng,
                amount_mode,
            )
        deposit_amounts = _order_amounts_with_spacing(deposit_amounts, rng, min_gap=max(500, _amount_step_for_mode(amount_mode)))

    for event, amount in zip(withdrawals, withdrawal_amounts):
        event.amount = float(amount)
    for event, amount in zip(deposits, deposit_amounts):
        event.amount = float(amount)

    if not _uses_closing_description_row(config):
        _force_final_transaction_date(planned, ending_business_date, posting_dates)

    planned.sort(key=lambda item: (item.date, 0 if item.event_type == "withdrawal" else 1))
    return planned, mix


def _force_final_transaction_date(
    planned: list[PlannedEvent],
    ending_business_date: date,
    posting_dates: set[date],
) -> None:
    if not planned or ending_business_date in posting_dates:
        return
    if any(event.date == ending_business_date for event in planned):
        return
    latest_index = max(range(len(planned)), key=lambda index: planned[index].date)
    planned[latest_index].date = ending_business_date


def _build_event_map(events: list[PlannedEvent]) -> dict[date, list[PlannedEvent]]:
    mapped: dict[date, list[PlannedEvent]] = {}
    for event in events:
        mapped.setdefault(event.date, []).append(event)
    for event_list in mapped.values():
        event_list.sort(key=lambda item: (0 if item.event_type == "withdrawal" else 1, item.sequence))
    return mapped


def _segment_interest(balance: float, annual_rate: float, days: int) -> float:
    if days <= 0 or balance <= 0:
        return 0.0
    return _round_half_up((balance * annual_rate * days) / 36_500.0, 4)


def _tax_rate_for_posting_date(config: StatementConfig, posting_date: date) -> float:
    if posting_date < TAX_RATE_CHANGE_DATE:
        return LEGACY_TAX_RATE
    return config.tax_rate


def _add_row(
    rows: list[StatementRow],
    summary: StatementSummary,
    row: StatementRow,
) -> None:
    rows.append(row)
    if row.category == "deposit":
        summary.total_deposits = round_money(summary.total_deposits + row.credit)
        summary.deposit_count += 1
    elif row.category == "withdrawal":
        summary.total_withdrawals = round_money(summary.total_withdrawals + row.debit)
        summary.withdrawal_count += 1
    elif row.category == "interest":
        summary.total_interest = round_money(summary.total_interest + row.credit)
    elif row.category == "tax":
        summary.total_tax = round_money(summary.total_tax + row.debit)


def simulate_statement(
    config: StatementConfig,
    plan: list[PlannedEvent],
    opening_business_date: date,
    ending_business_date: date,
    quarter_schedule: list[tuple[date, date]],
    rng: random.Random,
    enforce_max_rows: bool = True,
) -> tuple[list[StatementRow], StatementSummary, float, date]:
    rows: list[StatementRow] = []
    summary = StatementSummary()
    event_map = _build_event_map(plan)
    posting_dates = {posting_date for _, posting_date in quarter_schedule}

    balance = round_money(config.opening_balance)
    previous_quarter = _previous_quarter_date(opening_business_date, config.quarter_date_overrides)
    accrual_anchor = previous_quarter or opening_business_date
    quarter_segments: list[float] = []

    include_cheque_column = config.include_cheque_column
    use_closing_description_row = _uses_closing_description_row(config)
    cheque_number = _manual_cheque_start(plan, config.cheque_start)
    last_transaction_date = opening_business_date

    _add_row(
        rows,
        summary,
        StatementRow(
            date=opening_business_date,
            description=config.first_date_description.strip() or "Opening Balance",
            cheque_no="",
            debit=0.0,
            credit=0.0,
            balance=balance,
            category="opening",
            is_system=True,
        ),
    )

    closing_date = ending_business_date
    for posting_date in posting_dates:
        if posting_date > closing_date:
            closing_date = posting_date

    action_dates = sorted({*event_map.keys(), *posting_dates})

    def accrue_until(target_date: date) -> None:
        nonlocal accrual_anchor, quarter_segments, balance
        days = max(0, (target_date - accrual_anchor).days)
        if days > 0:
            segment = _segment_interest(balance, config.interest_rate, days)
            if segment > 0:
                quarter_segments.append(segment)
        accrual_anchor = target_date

    for current in action_dates:
        for event in event_map.get(current, []):
            accrue_until(current)
            if event.event_type == "deposit":
                balance = round_money(balance + event.amount)
                _add_row(
                    rows,
                    summary,
                    StatementRow(
                        date=current,
                        description=_description_for_event(event, config, rng),
                        cheque_no="",
                        debit=0.0,
                        credit=event.amount,
                        balance=balance,
                        category="deposit",
                        is_system=False,
                    ),
                )
            else:
                if balance - event.amount < 0:
                    raise ValueError(
                        f"Withdrawal of Rs. {format_amount(event.amount)} on {iso_date(current)} makes the balance negative."
                    )
                balance = round_money(balance - event.amount)
                cheque_text = str(cheque_number)
                display_description = _description_with_optional_cheque(
                    _description_for_event(event, config, rng),
                    cheque_text,
                    include_cheque_column,
                )
                row_cheque_text = cheque_text if include_cheque_column else ""
                cheque_number += 1
                _add_row(
                    rows,
                    summary,
                    StatementRow(
                        date=current,
                        description=display_description,
                        cheque_no=row_cheque_text,
                        debit=event.amount,
                        credit=0.0,
                        balance=balance,
                        category="withdrawal",
                        is_system=False,
                    ),
                )
            last_transaction_date = current

        if current in posting_dates:
            accrue_until(current)
            interest_amount = _round_half_up(sum(quarter_segments), 2)
            tax_amount = _round_half_up((interest_amount * _tax_rate_for_posting_date(config, current)) / 100.0, 2)
            quarter_segments = []
            if interest_amount > 0:
                balance = round_money(balance + interest_amount)
                _add_row(
                    rows,
                    summary,
                    StatementRow(
                        date=current,
                        description=config.interest_text,
                        cheque_no="",
                        debit=0.0,
                        credit=interest_amount,
                        balance=balance,
                        category="interest",
                        is_system=True,
                    ),
                )
                if tax_amount > 0:
                    balance = round_money(balance - tax_amount)
                    _add_row(
                        rows,
                        summary,
                        StatementRow(
                            date=current,
                            description=config.tax_text,
                            cheque_no="",
                            debit=tax_amount,
                            credit=0.0,
                            balance=balance,
                            category="tax",
                            is_system=True,
                        ),
                    )
                last_transaction_date = current
            accrual_anchor = current

    if use_closing_description_row:
        _add_row(
            rows,
            summary,
            StatementRow(
                date=closing_date,
                description=config.last_date_description.strip() or "Balance C/F",
                cheque_no="",
                debit=0.0,
                credit=0.0,
                balance=balance,
                category="closing",
                is_system=True,
            ),
        )
        last_transaction_date = closing_date
    if enforce_max_rows and len(rows) > MAX_STATEMENT_ROWS:
        raise ValueError(f"Generated statement has {len(rows)} rows, which exceeds the {MAX_STATEMENT_ROWS}-row limit.")
    return rows, summary, round_money(balance), last_transaction_date


def _latest_events_by_type(plan: list[PlannedEvent], event_type: EventType) -> list[PlannedEvent]:
    return sorted(
        [event for event in plan if event.event_type == event_type],
        key=lambda item: item.date,
        reverse=True,
    )


def _reconcile_plan(
    config: StatementConfig,
    plan: list[PlannedEvent],
    opening_business_date: date,
    ending_business_date: date,
    quarter_schedule: list[tuple[date, date]],
    rng: random.Random,
    enforce_max_rows: bool = True,
    amount_mix: dict | None = None,
) -> tuple[list[StatementRow], StatementSummary, float, date]:
    constraints = assign_rounding(plan, config, rng, amount_mix)
    # Every transaction may need an adjustment, plus room for interest corrections.
    for _ in range(len(plan) + 40):
        result = simulate_statement(config, plan, opening_business_date, ending_business_date,
                                    quarter_schedule, rng, enforce_max_rows=enforce_max_rows)
        delta = round_money(config.target_closing_balance - result[2])
        if abs(delta) <= 100 or not adjust_plan(plan, config, constraints, delta, ending_business_date, rng):
            return result
    return simulate_statement(config, plan, opening_business_date, ending_business_date,
                              quarter_schedule, rng, enforce_max_rows=enforce_max_rows)


def _manual_plan_from_rows(
    config: StatementConfig,
    rows: list[dict[str, object]],
    quarter_schedule: list[tuple[date, date]] | None = None,
) -> list[PlannedEvent]:
    plan: list[PlannedEvent] = []
    sequence = 0
    posting_dates = {iso_date(posting_date) for _, posting_date in quarter_schedule or []}

    def normalized_event_date(day_value: date) -> date:
        candidate = day_value
        while not is_business_day(candidate, config.holiday_dates) or iso_date(candidate) in posting_dates:
            candidate = next_business_day(candidate, config.holiday_dates, include_self=False)
            while iso_date(candidate) in posting_dates:
                candidate += timedelta(days=1)
                candidate = resolve_business_day(candidate, config.holiday_dates)
        return candidate

    for row in rows:
        if not isinstance(row, dict):
            continue
        category = str(row.get("category", "")).strip()
        if category in {"interest", "tax"}:
            continue
        debit = round_money(float(row.get("debit", 0) or 0))
        credit = round_money(float(row.get("credit", 0) or 0))
        if debit > 0 and credit > 0:
            raise ValueError("A statement row cannot contain both debit and credit amounts.")
        if debit <= 0 and credit <= 0:
            continue
        event_date = date.fromisoformat(str(row.get("date", "")))
        event_date = normalized_event_date(event_date)
        event_type: EventType = "deposit" if credit > 0 else "withdrawal"
        plan.append(
            PlannedEvent(
                event_type=event_type,
                date=event_date,
                amount=credit if credit > 0 else debit,
                description=_normalized_manual_description(config, event_type, str(row.get("description", "")).strip()),
                cheque_no=str(row.get("cheque_no", "")).strip() if config.include_cheque_column else "",
                sequence=sequence,
            )
        )
        sequence += 1
    return plan


def _manual_cheque_start(plan: list[PlannedEvent], fallback: int) -> int:
    for event in sorted(plan, key=lambda item: (item.date, item.sequence)):
        if event.event_type != "withdrawal":
            continue
        cheque_text = event.cheque_no.strip()
        if cheque_text.isdigit():
            return max(1, int(cheque_text))
    return max(1, fallback)


def validate_config(config: StatementConfig, require_growth: bool = True) -> None:
    if not config.customer_name.strip():
        raise ValueError("Customer name is required.")
    if config.start_date >= config.end_date:
        raise ValueError("Start date must be earlier than end date.")
    if config.target_closing_balance <= 0 or config.opening_balance < 0:
        raise ValueError("Opening and closing balances must be positive values.")
    if require_growth and config.target_closing_balance <= config.opening_balance:
        raise ValueError("Target closing balance must be greater than opening balance.")
    if not (0 <= config.interest_rate <= 100):
        raise ValueError("Interest rate must be between 0 and 100.")
    if not (0 <= config.tax_rate <= 100):
        raise ValueError("Tax rate must be between 0 and 100.")
    if config.include_cheque_column and config.cheque_start < 1:
        raise ValueError("Cheque start number must be at least 1.")
    if config.deposit_min_amount < 1 or config.deposit_max_amount < config.deposit_min_amount:
        raise ValueError("Deposit minimum and maximum amounts must be valid.")
    if config.withdrawal_min_amount < 1 or config.withdrawal_max_amount < config.withdrawal_min_amount:
        raise ValueError("Withdraw minimum and maximum amounts must be valid.")
    if config.amount_rounding_mode == "custom":
        parse_percentages(config.amount_rounding_percentages)
    _amount_range(config, "deposit")
    _amount_range(config, "withdrawal")
    if str(config.statement_row_mode).strip().lower() == "custom":
        if config.statement_row_count is None or config.statement_row_count < MIN_CUSTOM_STATEMENT_ROWS or config.statement_row_count > MAX_STATEMENT_ROWS:
            raise ValueError(f"Custom row count must stay between {MIN_CUSTOM_STATEMENT_ROWS} and {MAX_STATEMENT_ROWS}.")
    if str(config.transaction_count_mode).strip().lower() == "custom":
        if not config.monthly_transaction_counts:
            raise ValueError("Enter customized transaction counts for at least one month.")
        for (year, month), count in config.monthly_transaction_counts.items():
            if year < 1900 or month < 1 or month > 12 or count < 0 or count > CUSTOM_MONTHLY_TRANSACTION_CAP:
                raise ValueError(f"Monthly transaction counts must be between 0 and {CUSTOM_MONTHLY_TRANSACTION_CAP} for valid months.")
    if config.prepend_statement_mode:
        if config.prepend_start_date is None:
            raise ValueError("Previous statement start date is required when Add Statement Before is enabled.")
        if config.prepend_anchor_date is None:
            raise ValueError("Existing statement start date is required when Add Statement Before is enabled.")
        if config.prepend_start_date >= config.prepend_anchor_date:
            raise ValueError("Previous statement start date must be earlier than the existing statement start date.")
        if config.prepend_anchor_date > config.end_date:
            raise ValueError("Existing statement start date must be within the statement period.")


def _desired_statement_row_count(config: StatementConfig) -> int | None:
    if str(config.statement_row_mode).strip().lower() != "custom":
        return None
    return int(config.statement_row_count) if config.statement_row_count is not None else None


def validate_transaction_dates(config: StatementConfig, rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """Validate dates before preserving rows, showing a preview, or exporting."""
    errors: list[dict[str, object]] = []
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            continue
        description = str(row.get("description", "")).strip()
        debit = round_money(float(row.get("debit", 0) or 0))
        credit = round_money(float(row.get("credit", 0) or 0))
        date_fields = ["date"] + [key for key in ("txn_date", "value_date") if str(row.get(key, "")).strip()]
        checked_dates: set[str] = set()
        for field_name in date_fields:
            date_text = str(row.get(field_name, "")).strip()
            if date_text in checked_dates:
                continue
            checked_dates.add(date_text)
            try:
                row_date = date.fromisoformat(date_text)
            except ValueError:
                errors.append({"row_index": index, "date": date_text, "description": description,
                               "message": "Enter a valid date for this row.", "fields": [field_name]})
                continue
            if debit <= 0 and credit <= 0:
                continue
            posting_dates = {iso_date(value) for value in _quarter_candidates(row_date, row_date, config.quarter_date_overrides)}
            category = _effective_edited_category(config, str(row.get("category", "")), description,
                                                 debit, credit, index, len(rows) - 1, date_text, posting_dates)
            legitimate_posting = category in {"interest", "tax"} and date_text in posting_dates
            message = ""
            if not is_business_day(row_date, config.holiday_dates) and not legitimate_posting:
                message = "Holiday/Saturday/Sunday entries are not allowed."
            elif date_text in posting_dates and not legitimate_posting:
                message = "Transactions are not allowed on interest/tax posting dates."
            if message:
                errors.append({"row_index": index, "date": date_text, "description": description,
                               "message": message, "fields": [field_name]})
    return errors


def validate_edited_statement(config: StatementConfig, edited_rows: list[dict[str, object]]) -> list[dict[str, object]]:
    validate_config(config, require_growth=False)
    if config.prepend_statement_mode:
        if config.prepend_anchor_date is None:
            return [
                {
                    "row_index": 0,
                    "date": "",
                    "description": "",
                    "message": "Existing statement start date is required when Add Statement Before is enabled.",
                    "fields": ["prepend_anchor_date"],
                }
            ]
        if not _preserved_rows_from_source(_rows_on_or_after(edited_rows, config.prepend_anchor_date)):
            return [
                {
                    "row_index": 0,
                    "date": config.prepend_anchor_date.isoformat(),
                    "description": "",
                    "message": "No existing statement rows were found on or after the existing statement start date.",
                    "fields": ["prepend_anchor_date"],
                }
            ]
        return validate_transaction_dates(config, _rows_on_or_after(edited_rows, config.prepend_anchor_date))
    opening_business_date = resolve_business_day(config.start_date, config.holiday_dates)
    ending_business_date = resolve_business_day(config.end_date, config.holiday_dates)
    quarter_schedule = build_quarter_schedule(
        opening_business_date,
        ending_business_date,
        config.holiday_dates,
        config.quarter_date_overrides,
    )
    posting_dates = {iso_date(posting_date) for _, posting_date in quarter_schedule}

    errors = validate_transaction_dates(config, edited_rows)
    running_balance = round_money(config.opening_balance)
    include_cheque_column = config.include_cheque_column
    expected_cheque: int | None = None
    last_index = len(edited_rows) - 1
    actual_system_rows: list[tuple[int, dict[str, object]]] = []

    def add_error(row_index: int, date_text: str, description: str, message: str, fields: list[str] | None = None) -> None:
        errors.append(
            {
                "row_index": row_index,
                "date": date_text,
                "description": description,
                "message": message,
                "fields": fields or [],
            }
        )

    for index, row in enumerate(edited_rows):
        if not isinstance(row, dict):
            continue
        messages: list[tuple[str, list[str]]] = []
        date_text = str(row.get("date", "")).strip()
        description = str(row.get("description", "")).strip()
        try:
            row_date = date.fromisoformat(date_text)
        except ValueError:
            add_error(index, date_text, description, "Enter a valid date for this row.", ["date"])
            continue

        debit = round_money(float(row.get("debit", 0) or 0))
        credit = round_money(float(row.get("credit", 0) or 0))
        balance = round_money(float(row.get("balance", 0) or 0))
        category = _effective_edited_category(
            config,
            str(row.get("category", "")).strip(),
            description,
            debit,
            credit,
            index,
            last_index,
            date_text,
            posting_dates,
        )
        if category in {"opening", "interest", "tax", "closing"}:
            actual_system_rows.append(
                (
                    index,
                    {
                        "date": row_date,
                        "description": description,
                        "debit": debit,
                        "credit": credit,
                        "balance": balance,
                        "category": category,
                    },
                )
            )

        if debit > 0 and credit > 0:
            messages.append(("A statement row cannot contain both debit and credit amounts.", ["debit", "credit"]))
        messages.extend(_description_validation_messages(config, category, description, debit, credit))

        if include_cheque_column and debit > 0 and category == "withdrawal":
            cheque = str(row.get("cheque_no", "")).strip()
            if not cheque or not cheque.isdigit():
                messages.append(("Cheque number must be numeric for withdrawal rows.", ["cheque_no"]))
            else:
                if expected_cheque is None:
                    expected_cheque = int(cheque)
                if int(cheque) != expected_cheque:
                    messages.append((f"Cheque number should be {expected_cheque} based on the first cheque number.", ["cheque_no"]))
                expected_cheque = (expected_cheque if expected_cheque is not None else int(cheque)) + 1

        if _uses_closing_description_row(config) and index == last_index and (debit > 0 or credit > 0):
            messages.append(
                (
                    "This statement is using Only Description for the last row. Change Last Row Style to Last Transaction Allowed to keep the final amount row.",
                    ["debit", "credit"],
                )
            )

        expected_balance = running_balance
        if category == "opening":
            expected_balance = round_money(config.opening_balance)
            running_balance = expected_balance
        elif category == "interest":
            running_balance = round_money(running_balance + credit)
            expected_balance = running_balance
        elif category == "tax":
            running_balance = round_money(running_balance - debit)
            expected_balance = running_balance
        elif credit > 0 and debit <= 0:
            running_balance = round_money(running_balance + credit)
            expected_balance = running_balance
        elif debit > 0 and credit <= 0:
            if running_balance - debit < 0:
                messages.append(("This withdrawal makes the balance negative.", ["debit"]))
            running_balance = round_money(running_balance - debit)
            expected_balance = running_balance

        if abs(expected_balance - balance) > 0.01:
            messages.append((f"Balance should be Rs. {format_amount(expected_balance)} on this row.", ["balance"]))

        for message, fields in messages:
            add_error(index, date_text, description, message, fields)

    try:
        expected_result = recalculate_edited_statement(config, edited_rows)
    except Exception:
        expected_result = None

    if expected_result is not None:
        expected_system_rows = [row for row in expected_result.rows if row.category in {"opening", "interest", "tax", "closing"}]
        for position, (row_index, actual_row) in enumerate(actual_system_rows):
            if position >= len(expected_system_rows):
                add_error(
                    row_index,
                    iso_date(actual_row["date"]),
                    str(actual_row["description"]),
                    "This system row is not expected in the recalculated statement.",
                    ["date", "description", "debit", "credit"],
                )
                continue
            expected_row = expected_system_rows[position]
            if str(actual_row["category"]) != expected_row.category:
                add_error(
                    row_index,
                    iso_date(actual_row["date"]),
                    str(actual_row["description"]),
                    f"This row should be {expected_row.category.title()} instead of {actual_row['category']}.",
                    ["description"],
                )
            if str(actual_row["category"]) in {"interest", "tax"}:
                if actual_row["date"] != expected_row.date:
                    add_error(
                        row_index,
                        iso_date(actual_row["date"]),
                        str(actual_row["description"]),
                        f"{expected_row.category.title()} should post on {expected_row.date.isoformat()}.",
                        ["date"],
                    )
                if str(actual_row["description"]).strip() != expected_row.description.strip():
                    add_error(
                        row_index,
                        iso_date(actual_row["date"]),
                        str(actual_row["description"]),
                        f"{expected_row.category.title()} description should be '{expected_row.description}'.",
                        ["description"],
                    )
                if abs(float(actual_row["debit"]) - expected_row.debit) > 0.01:
                    add_error(
                        row_index,
                        iso_date(actual_row["date"]),
                        str(actual_row["description"]),
                        f"Debit should be Rs. {format_amount(expected_row.debit)} for this {expected_row.category} row.",
                        ["debit"],
                    )
                if abs(float(actual_row["credit"]) - expected_row.credit) > 0.01:
                    add_error(
                        row_index,
                        iso_date(actual_row["date"]),
                        str(actual_row["description"]),
                        f"Credit should be Rs. {format_amount(expected_row.credit)} for this {expected_row.category} row.",
                        ["credit"],
                    )
                if abs(float(actual_row["balance"]) - expected_row.balance) > 0.01:
                    add_error(
                        row_index,
                        iso_date(actual_row["date"]),
                        str(actual_row["description"]),
                        f"Balance should be Rs. {format_amount(expected_row.balance)} after this {expected_row.category} row.",
                        ["balance"],
                    )

    return errors


def _generate_statement_result(
    config: StatementConfig,
    *,
    require_growth: bool = True,
    enforce_max_rows: bool = True,
    enforce_target_tolerance: bool = True,
    seed_offset: int = 0,
) -> StatementResult:
    validate_config(config, require_growth=require_growth)
    validate_amount_mix(config)
    seed = config.seed if config.seed is not None else random.SystemRandom().randint(10_000_000, 99_999_999)
    seed += seed_offset
    opening_business_date = resolve_business_day(config.start_date, config.holiday_dates)
    ending_business_date = resolve_business_day(config.end_date, config.holiday_dates)
    last_error: Exception | None = None

    for attempt in range(100):
        rng = random.Random(seed + attempt)
        try:
            quarter_schedule = build_quarter_schedule(
                opening_business_date,
                ending_business_date,
                config.holiday_dates,
                config.quarter_date_overrides,
            )
            plan, amount_mix = _create_transaction_plan(config, opening_business_date, ending_business_date, quarter_schedule, rng)
            rows, summary, final_balance, last_transaction_date = _reconcile_plan(
                config,
                plan,
                opening_business_date,
                ending_business_date,
                quarter_schedule,
                rng,
                enforce_max_rows=enforce_max_rows,
                amount_mix=amount_mix,
            )
            if enforce_target_tolerance and abs(final_balance - config.target_closing_balance) > 3_000:
                raise ValueError("Generated closing balance is still too far from the requested target.")
            issue_date = next_business_day(last_transaction_date, config.holiday_dates, include_self=False)
            return StatementResult(
                rows=rows,
                summary=summary,
                events=plan,
                final_balance=final_balance,
                opening_business_date=opening_business_date,
                ending_business_date=ending_business_date,
                last_transaction_date=last_transaction_date,
                issue_date=issue_date,
                seed=seed + attempt,
                seed_label=str(seed + attempt),
            )
        except Exception as error:  # pragma: no cover - guarded by retries
            last_error = error
    raise RuntimeError(str(last_error or "Unable to generate a statement for the selected inputs."))


def generate_statement(config: StatementConfig) -> StatementResult:
    return _generate_statement_result(config)


def _summary_from_rows(rows: list[StatementRow]) -> StatementSummary:
    summary = StatementSummary()
    for row in rows:
        if row.category == "deposit":
            summary.total_deposits = round_money(summary.total_deposits + row.credit)
            summary.deposit_count += 1
        elif row.category == "withdrawal":
            summary.total_withdrawals = round_money(summary.total_withdrawals + row.debit)
            summary.withdrawal_count += 1
        elif row.category == "interest":
            summary.total_interest = round_money(summary.total_interest + row.credit)
        elif row.category == "tax":
            summary.total_tax = round_money(summary.total_tax + row.debit)
    return summary


def _previous_business_day_before(anchor_date: date, earliest_date: date, holidays: set[date]) -> date:
    current = anchor_date - timedelta(days=1)
    while current >= earliest_date:
        if is_business_day(current, holidays):
            return current
        current -= timedelta(days=1)
    raise ValueError("There is no working day available before the existing statement start date.")


def _next_cheque_number_from_rows(rows: list[StatementRow], fallback: int) -> str:
    numbers = [int(row.cheque_no) for row in rows if row.cheque_no.strip().isdigit()]
    return str(max(numbers) + 1 if numbers else max(1, fallback))


def _force_previous_rows_to_anchor(
    config: StatementConfig,
    rows: list[StatementRow],
    anchor_balance: float,
    adjustment_date: date,
) -> list[StatementRow]:
    prepared = list(rows)
    while prepared and prepared[-1].category == "closing":
        prepared.pop()
    current_balance = round_money(prepared[-1].balance if prepared else config.opening_balance)
    target_balance = round_money(anchor_balance)
    delta = round_money(target_balance - current_balance)
    if abs(delta) <= 0.01:
        return prepared

    if delta > 0:
        prepared.append(
            StatementRow(
                date=adjustment_date,
                description=config.deposit_text.strip() or "Cash Deposit",
                cheque_no="",
                debit=0.0,
                credit=delta,
                balance=target_balance,
                category="deposit",
                is_system=False,
            )
        )
    else:
        prepared.append(
            StatementRow(
                date=adjustment_date,
                description=_description_with_optional_cheque(
                    config.withdrawal_text.strip() or "Cheque Withdrawal",
                    _next_cheque_number_from_rows(prepared, config.cheque_start),
                    config.include_cheque_column,
                ),
                cheque_no=_next_cheque_number_from_rows(prepared, config.cheque_start) if config.include_cheque_column else "",
                debit=abs(delta),
                credit=0.0,
                balance=target_balance,
                category="withdrawal",
                is_system=False,
            )
        )
    return prepared


def _rows_on_or_after(rows: list[dict[str, object]], anchor_date: date) -> list[dict[str, object]]:
    selected: list[dict[str, object]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            row_date = date.fromisoformat(str(row.get("date", "")).strip())
        except ValueError:
            continue
        if row_date >= anchor_date:
            selected.append(row)
    return selected


def _preserved_statement_row(row: dict[str, object]) -> StatementRow:
    row_date = date.fromisoformat(str(row.get("date", "")).strip())
    return StatementRow(
        date=row_date,
        description=str(row.get("description", "")).strip(),
        cheque_no=str(row.get("cheque_no", "")).strip(),
        debit=round_money(float(row.get("debit", 0) or 0)),
        credit=round_money(float(row.get("credit", 0) or 0)),
        balance=round_money(float(row.get("balance", 0) or 0)),
        category=str(row.get("category", "")).strip() or "manual",
        is_system=bool(row.get("is_system", False)),
    )


def _preserved_rows_from_source(rows: list[dict[str, object]]) -> list[StatementRow]:
    preserved: list[StatementRow] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            preserved.append(_preserved_statement_row(row))
        except (TypeError, ValueError):
            continue
    return preserved


def _recalculate_with_prepend(config: StatementConfig, edited_rows: list[dict[str, object]]) -> StatementResult:
    if config.prepend_start_date is None or config.prepend_anchor_date is None:
        raise ValueError("Previous statement start and existing statement start dates are required.")

    anchor_date = config.prepend_anchor_date
    tail_source_rows = _rows_on_or_after(edited_rows, anchor_date)
    date_errors = validate_transaction_dates(config, tail_source_rows)
    if date_errors:
        raise ValueError(str(date_errors[0]["message"]) + " Correct the existing statement before adding previous rows.")
    tail_rows = _preserved_rows_from_source(tail_source_rows)
    if not tail_rows:
        raise ValueError("No existing statement rows were found on or after the existing statement start date.")
    anchor_balance = round_money(tail_rows[0].balance if tail_rows else config.prepend_anchor_balance)
    if anchor_balance <= 0:
        raise ValueError("Existing statement first balance must be greater than zero.")
    previous_end_date = _previous_business_day_before(anchor_date, config.prepend_start_date, config.holiday_dates)
    previous_config = replace(
        config,
        start_date=config.prepend_start_date,
        end_date=previous_end_date,
        target_closing_balance=anchor_balance,
        prepend_statement_mode=False,
    )
    previous_result: StatementResult | None = None
    previous_rows: list[StatementRow] = []
    last_error: Exception | None = None
    for attempt in range(1, 8):
        try:
            previous_result = _generate_statement_result(
                previous_config,
                require_growth=False,
                enforce_max_rows=False,
                enforce_target_tolerance=False,
                seed_offset=10_000 * attempt,
            )
            previous_rows = _force_previous_rows_to_anchor(
                previous_config,
                previous_result.rows,
                anchor_balance,
                previous_result.ending_business_date,
            )
            if previous_rows and abs(round_money(previous_rows[-1].balance - anchor_balance)) <= 0.01:
                break
        except Exception as error:
            last_error = error
            previous_rows = []
            previous_result = None
    else:
        detail = f" {last_error}" if last_error else ""
        raise ValueError(f"Could not make the previous statement match the present statement first balance. Try again with a different seed or amount limits.{detail}")

    if previous_result is None or not previous_rows:
        raise ValueError("Could not create the previous statement rows.")
    if abs(round_money(previous_rows[-1].balance - anchor_balance)) > 0.01:
        raise ValueError("Previous statement final balance did not match the present statement first balance exactly.")

    rows = previous_rows + tail_rows
    summary = _summary_from_rows(rows)
    final_balance = tail_rows[-1].balance
    last_transaction_date = tail_rows[-1].date
    issue_date = next_business_day(last_transaction_date, config.holiday_dates, include_self=False)
    return StatementResult(
        rows=rows,
        summary=summary,
        events=previous_result.events,
        final_balance=final_balance,
        opening_business_date=previous_result.opening_business_date,
        ending_business_date=tail_rows[-1].date,
        last_transaction_date=last_transaction_date,
        issue_date=issue_date,
        seed=0,
        seed_label="Edited + Previous",
        is_manual_edit=True,
    )


def recalculate_edited_statement(config: StatementConfig, edited_rows: list[dict[str, object]]) -> StatementResult:
    validate_config(config, require_growth=False)
    if config.prepend_statement_mode:
        return _recalculate_with_prepend(config, edited_rows)
    opening_business_date = resolve_business_day(config.start_date, config.holiday_dates)
    ending_business_date = resolve_business_day(config.end_date, config.holiday_dates)
    quarter_schedule = build_quarter_schedule(
        opening_business_date,
        ending_business_date,
        config.holiday_dates,
        config.quarter_date_overrides,
    )
    plan = _manual_plan_from_rows(config, edited_rows, quarter_schedule)
    rows, summary, final_balance, last_transaction_date = simulate_statement(
        config,
        plan,
        opening_business_date,
        ending_business_date,
        quarter_schedule,
        random.Random(config.seed or 0),
    )
    issue_date = next_business_day(last_transaction_date, config.holiday_dates, include_self=False)
    return StatementResult(
        rows=rows,
        summary=summary,
        events=plan,
        final_balance=final_balance,
        opening_business_date=opening_business_date,
        ending_business_date=ending_business_date,
        last_transaction_date=last_transaction_date,
        issue_date=issue_date,
        seed=0,
        seed_label="Edited",
        is_manual_edit=True,
    )


def names_from_text(value: str) -> list[str]:
    return parse_multiline_list(value)
