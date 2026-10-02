"""Consecutive customer-transaction groups, independent of amount rounding."""

import math

RUN_LIMITS = {"debit": 3, "credit": 4}
RUN_DEFAULTS = {key: value for side, limit in RUN_LIMITS.items()
                for key, value in [(f"{side}_run_mode", "automatic"),
                                   *[(f"{side}_run_{length}", "0") for length in range(2, limit + 1)]]}
FIT_ERROR = ("The consecutive transaction settings cannot fit the transaction count and the 45–70% debit/credit ratio. "
             "Change the group counts/percentages, increase the transaction count, or set one side to Automatic.")


def parse_run_rules(config):
    get = config.get if isinstance(config, dict) else lambda key, default: getattr(config, key, default)
    rules = {}
    for side, limit in RUN_LIMITS.items():
        mode = str(get(f"{side}_run_mode", "automatic")).strip().lower()
        if mode not in {"automatic", "count", "percentage"}:
            raise ValueError(f"Choose Automatic, Number of groups, or Percentage for {side} consecutive transactions.")
        rules[f"{side}_run_mode"] = mode
        values = []
        for length in range(2, limit + 1):
            raw = get(f"{side}_run_{length}", 0)
            try:
                value = 0.0 if mode == "automatic" else float(raw)
            except (TypeError, ValueError) as error:
                raise ValueError(f"Enter a valid {side} value for groups of {length}.") from error
            maximum = 100 if mode == "percentage" else 2000
            if (mode != "automatic" and isinstance(raw, bool)) or not math.isfinite(value) or not 0 <= value <= maximum:
                raise ValueError(f"Each {side} consecutive value must be from 0 to {maximum}.")
            if mode == "count" and not value.is_integer():
                raise ValueError(f"Number of {side} groups must be a whole number.")
            rules[f"{side}_run_{length}"] = value
            values.append(value)
        if mode == "percentage" and sum(values) > 100 + 1e-8:
            raise ValueError(f"Consecutive {side} percentages must total 100% or less; the remainder is single transactions.")
    return rules


def _spec(total, side, rules):
    limit = RUN_LIMITS[side]
    mode = rules[f"{side}_run_mode"]
    if mode != "automatic":
        counts = {length: (int(rules[f"{side}_run_{length}"]) if mode == "count" else
                           math.floor(total * rules[f"{side}_run_{length}"] / (100 * length) + 1e-9))
                  for length in range(2, limit + 1)}
        counts[1] = total - sum(length * count for length, count in counts.items())
        if counts[1] < 0:
            return None
        runs = sum(counts.values())
        return {"total": total, "limit": limit, "counts": counts, "min": runs, "max": runs, "manual": True}
    # Preserve automatic single debits and pairs; triples and credit fours
    # are included whenever the two sides have enough compatible run slots.
    counts = {length: 0 for length in range(1, limit + 1)}
    if total:
        counts[1] = 1
    if side == "debit" and total >= 3:
        counts[2] = 1
    remaining = total - sum(length * count for length, count in counts.items())
    runs = sum(counts.values())
    return {"total": total, "limit": limit, "counts": counts, "min": runs + (remaining + limit - 1) // limit,
            "max": runs + remaining, "manual": False}


def counts_fit_runs(credits, debits, rules):
    credit, debit = _spec(credits, "credit", rules), _spec(debits, "debit", rules)
    return (credit is not None and debit is not None and
            credit["min"] <= debit["max"] + 1 and debit["min"] <= credit["max"] + 1)


def _all_lengths_fit(spec, runs):
    remaining_runs = runs - spec["limit"]
    remaining_total = spec["total"] - spec["limit"] * (spec["limit"] + 1) // 2
    return not spec["manual"] and 0 <= remaining_runs <= remaining_total <= remaining_runs * spec["limit"]


def _lengths(spec, runs, rng):
    counts = spec["counts"]
    if _all_lengths_fit(spec, runs):
        counts = {length: 1 for length in range(1, spec["limit"] + 1)}
    lengths = [length for length, count in counts.items() for _ in range(count)]
    if not spec["manual"]:
        remaining_total, remaining_runs = spec["total"] - sum(lengths), runs - len(lengths)
        while remaining_runs:
            minimum = max(1, remaining_total - spec["limit"] * (remaining_runs - 1))
            maximum = min(spec["limit"], remaining_total - remaining_runs + 1)
            length = rng.randint(minimum, maximum)
            lengths.append(length)
            remaining_total -= length
            remaining_runs -= 1
    if lengths:
        # Choose the first length by type, so rare triples/fours can also open.
        first = rng.choice(sorted(set(lengths)))
        lengths.remove(first)
        rng.shuffle(lengths)
        lengths.insert(0, first)
    return lengths


def transaction_sequence(credits, debits, rng, config=None):
    rules = parse_run_rules(config or {})
    if not counts_fit_runs(credits, debits, rules):
        raise ValueError(FIT_ERROR)
    specs = {"deposit": _spec(credits, "credit", rules), "withdrawal": _spec(debits, "debit", rules)}
    credit, debit = specs.values()
    candidates, best = [], -1
    for credit_runs in range(credit["min"], credit["max"] + 1):
        for debit_runs in range(max(debit["min"], credit_runs - 1), min(debit["max"], credit_runs + 1) + 1):
            score = int(_all_lengths_fit(credit, credit_runs)) + int(_all_lengths_fit(debit, debit_runs))
            if score > best:
                candidates, best = [], score
            if score == best:
                candidates.append((credit_runs, debit_runs))
    credit_runs, debit_runs = rng.choice(candidates)
    kind = ("deposit" if credit_runs > debit_runs else "withdrawal" if debit_runs > credit_runs
            else rng.choice(["deposit", "withdrawal"]))
    lengths = {"deposit": _lengths(credit, credit_runs, rng), "withdrawal": _lengths(debit, debit_runs, rng)}
    positions = {"deposit": 0, "withdrawal": 0}
    sequence = []
    for _ in range(credit_runs + debit_runs):
        sequence.extend([kind] * lengths[kind][positions[kind]])
        positions[kind] += 1
        kind = "withdrawal" if kind == "deposit" else "deposit"
    return sequence
