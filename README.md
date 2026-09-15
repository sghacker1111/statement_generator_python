# Statement Generator V2 - Python

This repository contains the Python web edition of Statement Generator V2, a responsive application for generating, checking, editing, printing, and exporting configurable financial statements and balance certificates.

> This project creates SAMPLE documents for demonstrations and software testing. Generated statements and certificates are visibly labelled and must not be represented as bank-issued records.

## Code repositories

- [Python edition](https://github.com/sghacker1111/statement_generator_python)
- [PHP edition](https://github.com/sghacker1111/statement_generator_php)

## What it does

- Generates single-year and multi-year statements with exact balance reconciliation.
- Supports configurable deposit and withdrawal ranges.
- Uses a combined 70% / 20% / 10% automatic rounding mix, with customizable transaction percentages.
- Randomizes the credit transaction count to exceed debits by 5 to 10. See [rounding rules](ROUNDING_RULES.md).
- Supports default and custom transaction counts for large statements.
- Applies holiday, weekend, interest, and historical tax rules.
- Adds earlier periods while matching an existing statement balance.
- Imports, checks, edits, recalculates, and exports statements.
- Produces normal and customized Excel statements and Word certificates.
- Expands short Excel templates while preserving the final transaction row's style.
- Includes Excel and Word-style browser editors with formulas and formatting tools.
- Provides portrait, landscape, zoom, fit-width, and full-screen editor views.
- Supports User, Super Admin, and Admin access levels.

## Built with

- Python 3
- JavaScript, HTML5, and CSS3
- OpenPyXL
- python-docx
- PowerShell and Microsoft Office automation
- JSON-backed application state
- Git and GitHub

## How Codex and GPT-5.6 were used

Codex and GPT-5.6 were used as development collaborators throughout the project. They helped us:

- Understand the original generator and organize it into web-facing modules.
- Keep the Python behavior aligned with the separately hosted PHP edition.
- Implement amount limits, mixed-denomination rounding, and balance reconciliation.
- Improve multi-year generation and earlier-statement insertion workflows.
- Build custom Excel row expansion that preserves formats and summary placement.
- Develop the responsive one-page interface and document editor controls.
- Diagnose print-preview, Office export, and mobile layout problems.
- Add and run Python, JavaScript, PowerShell, real Excel, and browser-level tests.
- Prepare repository documentation and focused Git commits.

Codex accelerated coding, review, debugging, and verification, while project requirements, product decisions, and final acceptance remained under human direction.

## For judges: how to check and test

Use this edition to review the Python implementation and native `.xlsx`/`.docx` export path. Allow about 10 minutes for the core test; customized Microsoft Office automation requires a Windows desktop with Excel and Word installed.

### Access

- Sign-in is required. Request a temporary judge account from the project owner.
- Credentials are provided privately and are intentionally not stored in this public README.
- A **User** account can create, check, edit, print, and export statements. A **Super Admin** account can exercise the complete statement workspace without accessing user-management data.
- The automated verification commands below do not require an account.

### Core review workflow

1. Install the optional export packages, start the server, and sign in with the temporary account.
2. In **Account Details**, enter sample account information and an opening balance.
3. In **Statement Rules**, select a date range, transaction-row mode, deposit/withdrawal limits, and an **Amount Rounding Type**.
4. Optionally customize descriptions under **Texts & Names**.
5. Select **Create Stat** beside **Cancel Edit** in the **Statement Preview** toolbar.
6. Confirm that dates, debits, credits, balances, descriptions, interest, and tax rows are internally consistent.
7. Open **Export and Print**, then test print preview and the normal Excel and Word exports.
8. Re-import the Excel result with **Import Statement** and confirm that it can be checked and edited.

### Advanced cases worth testing

- Choose **Custom Rows** and generate 120 or more transactions.
- Try the mixed rounding modes ending in 50, 10, and 5-unit denominations.
- Use **Add Statement Before** to prepend an earlier period and verify that the protected present statement remains unchanged and its first balance matches exactly.
- Generate dates around July 2023 and verify the historical tax-rate transition.
- Upload a short customized Excel template, generate more transactions than its prepared rows, and confirm that new rows inherit the final transaction row's formatting.
- Open the Excel/Word editor and test formulas, formatting, zoom, fit-width, landscape view, and full-screen mode.

### Expected results

- The requested transaction count is generated without an artificial 120-row limit.
- Every running balance equals the preceding balance plus credit minus debit.
- Printed debit, credit, and balance values use comma separators and two decimal places; dates stay on one line.
- Normal Excel exports omit Bank Name, Branch, and Total rows.
- Added custom-template rows preserve borders, fills, fonts, number formats, formulas, row height, and summary placement.
- Earlier-period insertion reports an exact match before it is accepted.

### Review notes

- Python 3.10 or later is recommended.
- Install OpenPyXL and python-docx for native Excel and Word output: `python -m pip install openpyxl python-docx`.
- Customized Office-template automation requires Windows, Microsoft Excel, Microsoft Word, and permission to start Office automation.
- Internet access is optional and is used for exchange-rate and interest/tax posting-date refresh. Holidays use the supplied local list and manual changes; holiday synchronization is disabled.
- Do not use production credentials or real customer data during judging.

## Run locally

```powershell
cd "Web Statement Generator Python"
python app.py --open
```

Alternatively, run `start_web_statement_generator.bat`, then open:

`http://127.0.0.1:8050/`

## Export requirements

Normal exports work directly through the Python application. Customized Excel and Word template exports use Microsoft Office automation and require:

- Windows
- Microsoft Excel and Word installed
- An interactive account allowed to start Office automation

The browser editor can scan and update supported custom `.xlsx` and `.docx` formats before export.

## Verification

```powershell
python -m unittest statement_generator.selftest statement_generator.test_holidays statement_generator.test_rounding
node --check static/app.js
node --test tests/*.test.cjs
```

The test suite covers transaction planning, amount rules, historical tax handling, multi-year statements, balance reconciliation, validation, and recalculation.

## Website integration

The optional files in `site_integration/` can add a button from another website to this application. See [site_integration/README.md](site_integration/README.md) for setup details.

## Manual holidays

The supplied 243 dates are included in `data/manual_holidays.json`. Saturdays are always blocked, and Sundays remain blocked from April 5, 2026 under the existing rule. Add other holidays in **Holidays & Weekends**. See [HOLIDAY_RULES.md](HOLIDAY_RULES.md) for editing, account migration, and deployment details.

See [Office format editing, sample exports and A4 letterheads](OFFICE_FORMATS.md).
