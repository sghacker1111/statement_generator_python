"""Offline holiday defaults shared by the web and desktop applications."""

from datetime import date
from functools import lru_cache
import json
from pathlib import Path


SUNDAY_HOLIDAY_START = date(2026, 4, 5)
MANUAL_HOLIDAY_SEED_VERSION = 1


@lru_cache(maxsize=1)
def manual_holiday_dates() -> frozenset[str]:
    seed_file = Path(__file__).resolve().parent.parent / "data" / "manual_holidays.json"
    values = json.loads(seed_file.read_text(encoding="utf-8"))
    if not isinstance(values, list) or not values:
        raise ValueError("Manual holiday data must contain a list of ISO dates.")
    return frozenset(date.fromisoformat(value).isoformat() for value in values)


def is_recurring_holiday(day_value: date) -> bool:
    return day_value.weekday() == 5 or (day_value >= SUNDAY_HOLIDAY_START and day_value.weekday() == 6)
