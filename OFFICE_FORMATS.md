# SAMPLE document formats

Generated statements and balance certificates are demonstration documents. Exports include **SAMPLE — NOT A BANK-ISSUED DOCUMENT**. A4 previews and printed pages also carry a SAMPLE watermark and page label, including when a letterhead is used.

## Edit and save

Choose a format in **Export and Print**, then open **Edit Excel Format** or **Edit Word Format**. A bundled format gets a separate editable copy for your account. **Save All Format Changes** saves changes across the editor together, with rollback if any edit is invalid. The original bundled document remains unchanged.

Word previews preserve document order, supported fonts, paragraph spacing, indentation, images and tables. Excel editing preserves workbook formulas, dimensions, styles and merges. The browser editor supports common Office formatting; it is not Microsoft Office and cannot reproduce every floating shape, field, embedded object, macro or layout feature. Native template export uses Office to preserve the document more fully. Check complex templates in Office before relying on their layout.

Explicit object fields provide predictable substitution: `{{customer_name}}`, `{{customer_address}}`, `{{reference_no}}`, `{{issue_date}}`, `{{total_balance}}`, `{{exchange_rate}}`, `{{balance_words_npr}}`, `{{balance_words_usd}}`. Existing recognized field labels are also supported. Generated previews use the export result, including the current statement balance and selected exchange rate.

## File support

Install OpenPyXL and python-docx. `.xlsx` and `.docx` can be scanned and edited directly. Legacy `.xls` and `.doc` are converted to an editable OOXML copy, preserving the uploaded source. The conversion engine is Microsoft Office on Windows or LibreOffice on other hosts. Set `SGV2_LIBREOFFICE` if the LibreOffice executable is not on PATH. Unsupported or failed conversions return an error instead of rendering raw file bytes.

Native saved-template exports require Windows with Microsoft Excel and Word installed and an account permitted to automate them. Legacy exports are converted back to their selected extension. Normal web exports remain Excel/Word-compatible HTML; desktop normal exports and saved-template exports use native Office files. Formula recalculation occurs in Excel during native export.

## A4 letterheads and printing

Select the document type and a saved format or Normal Form. Upload a PNG/JPEG A4 letterhead up to 6 MB, set content margins in millimetres, and choose **Save letterhead**. Each user, document type and format has separate settings. The letterhead is repeated on every A4 preview/print page. Disable **Include saved letterhead** when printing on preprinted stationery. SAMPLE identification remains visible.

Use an image with A4 proportions, A4 paper and 100% scale, and disable browser-added URL/date headers. Actual printer output depends on its printable area. Letterheads apply to browser preview/printing and do not modify the editable Office template.

Transaction rows expand or shrink to fit above existing totals or the summary/footer. Formats without a total row do not receive an extra total row.

## Storage and verification

`letterheads/`, `custom_templates/`, and Office conversion caches are private runtime data and excluded from Git. Deploy the local files under `static/vendor/` together with `static/print-layout.js` and `static/office-workspace.js`.

Run:

```powershell
python -m unittest statement_generator.selftest statement_generator.test_holidays statement_generator.test_rounding statement_generator.test_office_formats
node --test tests/*.test.cjs
```

With Microsoft Office installed, also run:

```powershell
$env:SGV2_TEST_OFFICE = '1'
python -m unittest statement_generator.test_office_formats
```

The Office tests include legacy conversion, native row expansion/contraction, footer preservation, certificate fields, sample labels, formatting preservation, batch-save rollback and letterhead scoping.

A4 pagination uses [Paged.js](https://github.com/pagedjs/pagedjs), version 0.4.3, under the included MIT license.
