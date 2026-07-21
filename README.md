# Statement Generator V2 - Python

This repository contains the Python web edition of Statement Generator V2, a responsive application for generating, checking, editing, printing, and exporting configurable financial statements and balance certificates.

> This project is intended for authorized record preparation, internal workflows, demonstrations, and software testing. Generated documents must not be represented as official bank-issued records without authorization.

## Code repositories

- [Python edition](https://github.com/sghacker1111/statement_generator_python)
- [PHP edition](https://github.com/sghacker1111/statement_generator_php)

## What it does

- Generates single-year and multi-year statements with exact balance reconciliation.
- Supports configurable deposit and withdrawal ranges.
- Provides automatic and mixed amount rounding down to 5-unit denominations.
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
python -m unittest statement_generator.selftest
node --check static/app.js
```

The test suite covers transaction planning, amount rules, historical tax handling, multi-year statements, balance reconciliation, validation, and recalculation.

## Website integration

The optional files in `site_integration/` can add a button from another website to this application. See [site_integration/README.md](site_integration/README.md) for setup details.
