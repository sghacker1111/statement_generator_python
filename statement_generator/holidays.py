"""Offline holiday defaults shared by the web and desktop applications."""

from datetime import date
from functools import lru_cache
import json
from pathlib import Path


SUNDAY_HOLIDAY_START = date(2026, 4, 5)
MANUAL_HOLIDAY_SEED_VERSION = 2


@lru_cache(maxsize=1)
def manual_holiday_dates() -> frozenset[str]:
    seed_file = Path(__file__).resolve().parent.parent / "data" / "manual_holidays.json"
    values = json.loads(seed_file.read_text(encoding="utf-8"))
    if not isinstance(values, list) or not values:
        raise ValueError("Manual holiday data must contain a list of ISO dates.")
    return frozenset(date.fromisoformat(value).isoformat() for value in values)


def manual_holiday_additions(seed_version=0) -> frozenset[str]:
    """Migrate only later releases, retaining earlier manual holiday deletions."""
    seed_version = int(seed_version or 0)
    if seed_version < 1:
        return manual_holiday_dates()
    if seed_version >= MANUAL_HOLIDAY_SEED_VERSION:
        return frozenset()
    updates_file = Path(__file__).resolve().parent.parent / "data" / "manual_holiday_updates.json"
    updates = json.loads(updates_file.read_text(encoding="utf-8"))
    if not isinstance(updates, dict) or str(MANUAL_HOLIDAY_SEED_VERSION) not in updates:
        raise ValueError("The bundled manual holiday updates are missing or invalid.")
    return frozenset(date.fromisoformat(value).isoformat()
                     for version, values in updates.items()
                     if seed_version < int(version) <= MANUAL_HOLIDAY_SEED_VERSION
                     for value in values)


def is_recurring_holiday(day_value: date) -> bool:
    return day_value.weekday() == 5 or (day_value >= SUNDAY_HOLIDAY_START and day_value.weekday() == 6)
