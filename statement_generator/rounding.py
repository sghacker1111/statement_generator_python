"""Transaction-count rounding quotas shared across deposits and withdrawals."""

from collections import Counter
import json
import math

STEPS = (1000, 500, 100, 50, 10, 5)
CUSTOM_DEFAULTS = {1000: 35, 500: 35, 100: 10, 50: 10, 10: 0, 5: 10}


def parse_percentages(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (ValueError, TypeError) as error:
            raise ValueError("Enter rounding percentages totaling 100%.") from error
    if not isinstance(value, dict) or not value:
        raise ValueError("Enter rounding percentages totaling 100%.")
    result = {step: 0.0 for step in STEPS}
    for key, raw in value.items():
        if str(key) not in {str(step) for step in STEPS} or isinstance(raw, bool):
            raise ValueError("Choose rounding figures from 1000, 500, 100, 50, 10, and 5.")
        try:
            amount = float(raw)
        except (ValueError, TypeError) as error:
            raise ValueError("Each rounding percentage must be a number from 0 to 100.") from error
        if not math.isfinite(amount) or not 0 <= amount <= 100:
            raise ValueError("Each rounding percentage must be a number from 0 to 100.")
        result[int(key)] = amount
    if abs(sum(result.values()) - 100) > 0.000001:
        raise ValueError("Rounding percentages must total 100%.")
    return result


def amount_class(value):
    return next((step for step in STEPS if value % step == 0), None)


def candidates(value, step, minimum, maximum):
    """Nearby amounts in one exclusive class, without enumerating the amount range."""
    result = set()
    for anchor in (min(maximum, max(minimum, value)), minimum, maximum):
        base = math.floor(anchor / step) * step
        for offset in range(-5, 6):
            candidate = base + offset * step
            if minimum <= candidate <= maximum and amount_class(candidate) == step:
                result.add(candidate)
    return sorted(result)


def allocate_counts(total, percentages, rng):
    exact = {key: total * percent / 100 for key, percent in percentages.items()}
    counts = {key: math.floor(value) for key, value in exact.items()}
    order = list(exact)
    rng.shuffle(order)
    order.sort(key=lambda key: exact[key] - counts[key], reverse=True)
    for key in order[:total - sum(counts.values())]:
        counts[key] += 1
    return counts


def validate_amount_mix(config):
    if not config.deposit_min_amount < 30000 <= config.deposit_max_amount:
        raise ValueError("The credit amount mix requires limits allowing both amounts below 30,000 and amounts of 30,000 or more.")
    if not config.withdrawal_min_amount <= 50000 < config.withdrawal_max_amount:
        raise ValueError("The debit amount mix requires limits allowing both amounts above 50,000 and amounts of 50,000 or less.")


def _rounding_groups(config):
    members = {"large": (1000, 500), "medium": (100, 50), "small": (5,)}
    if config.amount_rounding_mode == "custom":
        groups = parse_percentages(config.amount_rounding_percentages)
    elif config.amount_rounding_mode.startswith("round_"):
        figures = [int(part) for part in config.amount_rounding_mode.split("_")[1:]
                   if part.isdigit() and int(part) in STEPS]
        if not figures:
            raise ValueError("Choose a supported rounding figure.")
        members["legacy"] = tuple(step for step in STEPS if step % min(figures) == 0)
        groups = {"legacy": 100}
    else:
        groups = {"large": 70, "medium": 20, "small": 10}
    return groups, members


def _capacities(counts, allowed):
    # Hall's condition: every subset of the four amount groups must have
    # enough compatible rounding slots. With integer capacities this is exact.
    return [sum(count for key, count in counts.items()
                if any(mask & (1 << bucket) and key in allowed[bucket] for bucket in range(4)))
            for mask in range(16)]


def _fits(demands, capacities):
    return all(sum(demands[bucket] for bucket in range(4) if mask & (1 << bucket)) <= capacities[mask]
               for mask in range(1, 16))


def prepare_mix(total, config, rng, debit_total=None):
    """Choose counts jointly so narrow amount limits cannot exhaust rounding slots."""
    validate_amount_mix(config)
    groups, members = _rounding_groups(config)
    counts = allocate_counts(total, groups, rng)
    bounds = [(config.deposit_min_amount, min(config.deposit_max_amount, 29999)),
              (max(config.deposit_min_amount, 30000), config.deposit_max_amount),
              (max(config.withdrawal_min_amount, 50001), config.withdrawal_max_amount),
              (config.withdrawal_min_amount, min(config.withdrawal_max_amount, 50000))]
    allowed = []
    for minimum, maximum in bounds:
        choices = {key: [step for step in members.get(key, (key,)) if candidates(minimum, step, minimum, maximum)]
                   for key, count in counts.items() if count}
        allowed.append({key: steps for key, steps in choices.items() if steps})
    capacities = _capacities(counts, allowed)
    debit_options = ([debit_total] if debit_total is not None else
                     list(range(max(5, (45 * total + 144) // 145), 70 * total // 170 + 1)))
    rng.shuffle(debit_options)
    for debits in debit_options:
        credits = total - debits
        low_options = []
        for low in range((20 * credits + 99) // 100, 30 * credits // 100 + 1):
            high_min, high_max = (10 * debits + 99) // 100, 20 * debits // 100
            for mask in range(1, 16):
                # A subset's demand is base + a*low + b*high.
                a = bool(mask & 1) - bool(mask & 2)
                b = bool(mask & 4) - bool(mask & 8)
                remaining = capacities[mask] - (credits if mask & 2 else 0) - (debits if mask & 8 else 0) - a * low
                if b == 1:
                    high_max = min(high_max, remaining)
                elif b == -1:
                    high_min = max(high_min, -remaining)
                elif remaining < 0:
                    high_max = -1
                    break
            if high_min <= high_max:
                low_options.append((low, high_min, high_max))
        if low_options:
            low, high_min, high_max = rng.choice(low_options)
            high = rng.randint(high_min, high_max)
            return {"counts": counts, "bounds": bounds, "allowed": allowed,
                    "demands": [low, credits - low, high, debits - high]}
    raise ValueError("The amount limits cannot fit the required amount groups and rounding percentages. Widen the deposit/withdrawal limits or change the percentages.")


def _amount_buckets(plan, mix, rng):
    buckets = [0] * len(plan)
    for kind, selected_bucket, other_bucket in (("deposit", 0, 1), ("withdrawal", 2, 3)):
        indices = [index for index, event in enumerate(plan) if event.event_type == kind]
        rng.shuffle(indices)
        for position, index in enumerate(indices):
            buckets[index] = selected_bucket if position < mix["demands"][selected_bucket] else other_bucket
    return buckets


def assign_rounding(plan, config, rng, mix=None):
    if mix is None:
        mix = prepare_mix(len(plan), config, rng, sum(event.event_type == "withdrawal" for event in plan))
    counts = dict(mix["counts"])
    demands = list(mix["demands"])
    buckets = _amount_buckets(plan, mix, rng)
    options = [(index, mix["allowed"][bucket]) for index, bucket in enumerate(buckets)]
    rng.shuffle(options)
    options.sort(key=lambda item: len(item[1]))
    constraints = [None] * len(plan)
    seen = Counter()
    for index, allowed in options:
        bucket = buckets[index]
        demands[bucket] -= 1
        available = []
        for key in allowed:
            if counts[key] <= 0:
                continue
            counts[key] -= 1
            if _fits(demands, _capacities(counts, mix["allowed"])):
                available.append(key)
            counts[key] += 1
        if not available:
            raise ValueError("The amount limits cannot fit the required amount groups and rounding percentages. Widen the deposit/withdrawal limits or change the percentages.")
        key = rng.choices(available, weights=[counts[key] for key in available], k=1)[0]
        step = rng.choice(allowed[key])
        counts[key] -= 1
        event = plan[index]
        minimum, maximum = mix["bounds"][bucket]
        target = event.amount if minimum <= event.amount <= maximum else rng.randint(minimum, maximum)
        choices = candidates(target, step, minimum, maximum)
        selected = min(choices, key=lambda value: (seen[(event.event_type, value)] * 2000 + abs(value - target), rng.random()))
        event.amount = float(selected)
        seen[(event.event_type, selected)] += 1
        constraints[index] = (step, minimum, maximum)
    return constraints


def adjust_plan(plan, config, constraints, delta, ending_date, rng):
    """Reconcile without changing amount groups, rounding classes, or counts."""
    seen = Counter((event.event_type, int(event.amount)) for event in plan)
    choices = []
    for index, event in enumerate(plan):
        sign = 1 if event.event_type == "deposit" else -1
        step, minimum, maximum = constraints[index]
        factor = 1 + config.interest_rate / 100 * max(0, (ending_date - event.date).days) / 365 * 0.94
        target = event.amount + delta / (sign * factor)
        for value in candidates(target, step, minimum, maximum):
            change = value - event.amount
            residual = abs(delta - change * sign * factor)
            if change and residual < abs(delta) - 0.01:
                duplicates = seen[(event.event_type, value)]
                choices.append((residual + duplicates * 10, rng.random(), index, value))
    if not choices:
        return False
    _, _, index, value = min(choices)
    plan[index].amount = float(value)
    return True
