# Manual holiday rules

Both editions use the same supplied list in `data/manual_holidays.json`: 243 unique ISO Gregorian dates from the 245 table entries. The duplicate dates `2025-03-08` and `2026-02-07` appear once. The supplied `2023-08-26` is retained as written; no date years have been inferred or corrected.

- Every Saturday is blocked, including dates beyond the supplied list.
- The existing Sunday rule is preserved: every Sunday from **2026-04-05** is blocked. Earlier Sundays are blocked only when present in the manual list.
- Other holidays are managed in **Holidays & Weekends**: choose a date, then **Add Holiday**. Select a manual holiday to modify or delete it. Changes still require the account password.
- Recurring Saturdays and Sundays cannot be modified or deleted. Older saved Saturday exclusions no longer reopen Saturdays.
- No holiday dates are downloaded from Hamro Patro. The retired holiday sync API is disabled. The independent interest/tax posting-date and NRB exchange-rate refresh features remain available.
- Deposits and withdrawals must use working days. The existing system interest/tax posting-date exception remains in effect for configured posting dates.

## Existing accounts

On first use of the updated version, the supplied dates are merged into each account's existing manual holiday settings. The seed version is saved so later manual modifications and deletions survive reloads. Existing dates are retained because the old storage does not distinguish dates added manually from dates downloaded previously.

An administrator can use **Admin & History > Restore Dates > Holidays Only** to reset the selected user's holidays to the supplied list. Other holiday changes remain scoped to the signed-in account.

## Uploading the update

Include the new `data/manual_holidays.json` with the updated application source. Keep live account state, database files, configuration, and uploaded templates in place. The PHP FTP workflow includes the new seed file and excludes saved holiday state.

Both editions package the same holiday list so they can be deployed independently. The Python desktop application also uses this list and the recurring weekend rules.
