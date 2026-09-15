# Transaction counts and rounding

In **Statement Rules → Transaction Counts & Rounding**, select **Automatic (70% / 20% / 10%)** or **Customized percentages**.

## Credit and debit counts

Credit transactions exceed debit transactions by a randomly selected **5 to 10**. The same seed reproduces the same result. The requested total and customized monthly transaction counts remain unchanged.

A fixed total determines which differences are possible: an even total permits 6, 8, or 10; an odd total permits 5, 7, or 9. At least seven customer transactions are required so that both columns contain transactions. The opening/closing balance, interest, and tax rows are excluded from this count. Very short statements may need longer deposit runs to meet the count rule.

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

Balance reconciliation preserves each assigned rounding class, the transaction counts, and amount limits. The existing closing-balance tolerance remains unchanged. If limits cannot accommodate a requested mix, generation reports an error; widen the limits or change the percentages. Interest and tax retain their existing calculation precision. Manual statement edits preserve the entered amounts rather than applying a new random distribution.

Holiday rules are unchanged: Saturdays are blocked, Sundays follow the existing effective-date rule, and other holidays are managed manually.

## Verification

The backend self-tests check all credit-count differences, exact monthly counts, the final automatic/custom rounding distribution after reconciliation, limits, determinism, and invalid percentages. Run `node --test tests/*.test.cjs` for frontend behavior, including profile restoration, mode switching, and validation.
