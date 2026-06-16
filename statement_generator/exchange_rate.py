from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
import json
from urllib.parse import urlencode
from urllib.request import Request, urlopen


NRB_FOREX_API_BASE = "https://www.nrb.org.np/api/forex/v1/rates"
NRB_FOREX_PAGE = "https://www.nrb.org.np/forex/"
NRB_FOREX_DOCS = "https://www.nrb.org.np/api-docs-v1/"
NRB_MAX_LOOKBACK_DAYS = 45
NRB_PAGE_SIZE = 100
NRB_USER_AGENT = "StatementGenerator/2.0 (+https://www.nrb.org.np/forex/)"


class ExchangeRateLookupError(RuntimeError):
    """Raised when the exchange rate service is unavailable."""


@dataclass(slots=True)
class ExchangeRateResult:
    rate: float
    rate_type: str
    source_date: date
    source_label: str


def _request_payload(from_date: date, to_date: date, timeout: int = 20) -> dict:
    query = urlencode(
        {
            "page": 1,
            "per_page": NRB_PAGE_SIZE,
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
        }
    )
    request = Request(
        f"{NRB_FOREX_API_BASE}?{query}",
        headers={
            "Accept": "application/json",
            "User-Agent": NRB_USER_AGENT,
        },
    )
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _read_rate_value(item: dict, rate_type: str) -> float | None:
    raw = item.get(rate_type)
    if raw in (None, ""):
        return None
    return float(str(raw).replace(",", "").strip())


def fetch_usd_npr_rate(issue_date: date, rate_type: str = "sell", timeout: int = 20) -> ExchangeRateResult:
    normalized_rate_type = rate_type.lower().strip()
    if normalized_rate_type not in {"buy", "sell"}:
        raise ValueError("Rate type must be either 'buy' or 'sell'.")

    effective_issue_date = min(issue_date, date.today())
    from_date = effective_issue_date - timedelta(days=NRB_MAX_LOOKBACK_DAYS)
    payload = _request_payload(from_date, effective_issue_date, timeout=timeout)
    if int(payload.get("status", {}).get("code", 0) or 0) >= 400:
        validation = payload.get("errors", {}).get("validation") or {}
        detail = "; ".join(
            f"{key}: {', '.join(map(str, value)) if isinstance(value, list) else value}"
            for key, value in validation.items()
        )
        raise ExchangeRateLookupError(
            f"Nepal Rastra Bank exchange-rate service rejected the lookup{': ' + detail if detail else '.'}"
        )
    entries = payload.get("data", {}).get("payload", []) or []
    for entry in reversed(entries):
        for item in entry.get("rates", []):
            currency = item.get("currency", {})
            if str(currency.get("iso3", currency.get("ISO3", ""))).upper() == "USD":
                rate_value = _read_rate_value(item, normalized_rate_type)
                if rate_value is None:
                    continue
                source_date = date.fromisoformat(entry["date"])
                return ExchangeRateResult(
                    rate=rate_value,
                    rate_type=normalized_rate_type,
                    source_date=source_date,
                    source_label=f"Nepal Rastra Bank {normalized_rate_type.title()} Rate",
                )
    raise ExchangeRateLookupError(
        "Could not find a USD/NPR exchange rate from Nepal Rastra Bank for the selected issue date."
    )
