# Manual holiday rules

Both editions use the same supplied list in `data/manual_holidays.json`: **332 unique ISO Gregorian dates**. The September 2026 update adds 89 new dates from the user's additional 91-entry table. `2023-08-26` and `2025-04-06` were already present and appear only once. All years are retained exactly as supplied; in particular, `2025-04-06` has not been changed to 2024.

- Every Saturday is blocked, including dates beyond the supplied list.
- The existing Sunday rule is preserved: every Sunday from **2026-04-05** is blocked. Earlier Sundays are blocked only when present in the manual list.
- Other holidays are managed in **Holidays & Weekends**: choose a date, then **Add Holiday**. Select a manual holiday to modify or delete it. Changes still require the account password.
- Recurring Saturdays and Sundays cannot be modified or deleted. Older saved Saturday exclusions no longer reopen Saturdays.
- No holiday dates are downloaded from Hamro Patro. The retired holiday sync API is disabled. The independent interest/tax posting-date and NRB exchange-rate refresh features remain available.
- Deposits and withdrawals must use working days. The existing system interest/tax posting-date exception remains in effect for configured posting dates.

## Existing accounts

New and legacy accounts receive the complete supplied list. Accounts already on seed version 1 receive only the dates in version 2 of `data/manual_holiday_updates.json`, preserving unrelated prior manual deletions and user-added holidays. The seed version is saved so later manual modifications and deletions survive reloads. This also applies to Python desktop settings and saved profiles.

An administrator can use **Admin & History > Restore Dates > Holidays Only** to reset the selected user's holidays to the supplied list. Other holiday changes remain scoped to the signed-in account.

## Uploading the update

Include both `data/manual_holidays.json` and `data/manual_holiday_updates.json` with the updated application source. Keep live account state, database files, configuration, and uploaded templates in place. The PHP FTP workflow includes the new seed file and excludes saved holiday state.

Both editions package the same holiday list so they can be deployed independently. The Python desktop application also uses this list and the recurring weekend rules.
