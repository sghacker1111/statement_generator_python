# Transaction counts and rounding

In **Statement Rules → Transaction Counts & Rounding**, select **Automatic (70% / 20% / 10%)** or **Customized percentages**.

## Credit and debit counts

The debit transaction count is randomly selected between **45% and 70% of the credit transaction count**, inclusive. For example, 100 credits allow 45–70 debits. A requested total is split only among integer counts that satisfy this ratio; customized monthly totals remain unchanged. The same seed reproduces the same result within each implementation.

At least **13 customer transactions** are required to satisfy all count and amount rules: the smallest valid mix is 8 credits and 5 debits. Opening/closing balance, interest, and tax rows are excluded from these percentages. A request that cannot fit the minimum reports an error.

Debit ordering includes randomly positioned **single debits and consecutive pairs**. The existing maximum of two consecutive debits and up to three pairs is retained. Credit runs remain at most three transactions; their distribution adapts to the selected debit/credit ratio.

## Amount groups

- **10–20% of debit transactions** have amounts strictly **above 50,000**. Other debits are 50,000 or less.
- **20–30% of credit transactions** have amounts strictly **below 30,000**. Other credits are 30,000 or more.

These are percentages of each column's transaction count, not percentages of the money total. Integer quotas are selected randomly within each interval and assigned to random transactions. Amount limits must allow both groups in each column. Incompatible limits, rounding figures, or closing-balance targets report an error instead of silently relaxing a rule.

## Automatic rounding

| Share of customer transactions | Rounding figures |
| --- | --- |
| 70% | Multiples of 1,000 or 500 |
| 20% | Multiples of 100 or 50 |
| 10% | Multiples of 5 |

These percentages apply to the **combined number of debit and credit transactions**, not the total monetary amount or each column separately. Figures are assigned randomly across both columns, within their configured amount limits.

Each amount belongs to its largest matching figure. For example, 25,000 is in the 1,000 class; 25,500 in 500; 25,100 in 100; 25,150 in 50; 25,110 in 10; and 25,115 in 5. Automatic mode does not allocate a separate 10 class.

## Customized percentages

Select **Customized percentages**, then enter a percentage for each figure: 1,000, 500, 100, 50, 10, and 5. Values must be between 0 and 100 and total **100%**. Decimal percentages are supported. Zero excludes a figure. The initial custom split is 35 / 35 / 10 / 10 / 0 / 10.

Percentages are converted into whole transaction counts using the largest remainder method: allocate whole portions first, then give the remaining transactions to the largest fractional portions, with seeded random tie-breaking. Each class differs from its ideal fractional count by less than one transaction. Small statements cannot represent every small percentage exactly.

Settings are preserved in saved profiles and statement configurations. Existing profiles without percentages receive the custom defaults. Existing single-figure and mixed-figure modes remain available.

Balance reconciliation preserves each assigned amount group and rounding class, the transaction counts, and amount limits in automatic, custom, and older saved rounding modes. The existing closing-balance tolerance remains unchanged. If limits cannot accommodate a requested mix, generation reports an error; widen the limits or change the percentages. Interest and tax retain their existing calculation precision. Manual statement edits preserve the entered amounts rather than applying a new random distribution. The manual Add Statement Before workflow can append an exact balance adjustment to join the preserved statement; that adjustment and manually entered rows are not governed by the automatic generation quotas.

Holiday rules are unchanged: Saturdays are blocked, Sundays follow the existing effective-date rule, and other holidays are managed manually.

## Verification

The backend self-tests check the debit/credit ratio, exact monthly counts, high-debit and low-credit quotas, single/paired debit ordering, strict amount boundaries, final rounding distributions, limits, determinism, and invalid percentages. Run `node --test tests/*.test.cjs` for frontend behavior, including profile restoration, mode switching, and validation.
