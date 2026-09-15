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


def assign_rounding(plan, config, rng):
    groups = ({"large": 70, "medium": 20, "small": 10}
              if config.amount_rounding_mode == "automatic" else parse_percentages(config.amount_rounding_percentages))
    counts = allocate_counts(len(plan), groups, rng)
    members = {"large": (1000, 500), "medium": (100, 50), "small": (5,)}
    bounds = lambda event: ((config.deposit_min_amount, config.deposit_max_amount) if event.event_type == "deposit"
                            else (config.withdrawal_min_amount, config.withdrawal_max_amount))
    options = []
    for index, event in enumerate(plan):
        minimum, maximum = bounds(event)
        allowed = {key: [step for step in members.get(key, (key,)) if candidates(event.amount, step, minimum, maximum)]
                   for key, count in counts.items() if count}
        allowed = {key: steps for key, steps in allowed.items() if steps}
        options.append((index, allowed))
    rng.shuffle(options)
    options.sort(key=lambda item: len(item[1]))
    steps_by_index = [0] * len(plan)
    seen = Counter()
    for index, allowed in options:
        available = [key for key in allowed if counts[key] > 0]
        if not available:
            raise ValueError("The amount limits cannot fit the requested rounding percentages. Widen the deposit/withdrawal limits or change the percentages.")
        key = rng.choices(available, weights=[counts[key] for key in available], k=1)[0]
        step = rng.choice(allowed[key])
        counts[key] -= 1
        event = plan[index]
        minimum, maximum = bounds(event)
        choices = candidates(event.amount, step, minimum, maximum)
        selected = min(choices, key=lambda value: (seen[(event.event_type, value)] * 2000 + abs(value - event.amount), rng.random()))
        event.amount = float(selected)
        seen[(event.event_type, selected)] += 1
        steps_by_index[index] = step
    return steps_by_index


def adjust_plan(plan, config, steps, delta, ending_date, rng):
    """Reconcile without changing assigned rounding classes or transaction counts."""
    seen = Counter((event.event_type, int(event.amount)) for event in plan)
    choices = []
    for index, event in enumerate(plan):
        sign = 1 if event.event_type == "deposit" else -1
        minimum, maximum = ((config.deposit_min_amount, config.deposit_max_amount) if sign == 1
                            else (config.withdrawal_min_amount, config.withdrawal_max_amount))
        factor = 1 + config.interest_rate / 100 * max(0, (ending_date - event.date).days) / 365 * 0.94
        target = event.amount + delta / (sign * factor)
        for value in candidates(target, steps[index], minimum, maximum):
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
