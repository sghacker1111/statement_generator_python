# PDF statement import

Open **Statement Check > Import PDF Statement > Choose PDF**. Select the numeric date order (day/month/year by default); month-name dates are detected automatically. Existing checking profiles, interest/tax rules and case-sensitive text checks still apply.

The browser reads each page with PDF.js. Pages without a usable transaction table, or with unreadable dates/amounts in their embedded text, are rendered and scanned with Tesseract OCR. A contrast pass can locate shaded table headings while values are read from the original scan. When PDF text is readable, it is retained; OCR can recover unreadable fields, and conflicting readings are shown for review. **Force OCR** can replace an unreliable PDF text layer. OCR can retry sideways or upside-down scans. The bundled OCR language is English (including English month names and digits); Nepali-script tables and handwritten statements are not supported by this release.

The importer locates Date, Description/Particulars, Debit, Credit and Balance headings; Cheque No. is optional. It merges pages in document order, drops repeated headers and removes explicit matching carried-forward/brought-forward balances at page boundaries. Ordinary repeated transactions are retained. Letterheads, page numbers, totals and signature/stamp areas outside the table are excluded. A stamp overlapping transaction text may need manual correction.

Review the extracted table before using **Import and check statement**. Unreadable amounts are retained for correction instead of becoming zero. Low-confidence OCR and pages with no detected rows show review messages. Edit cells, insert missed rows or remove a non-transaction row. The original PDF remains available in another tab for comparison. **Download extracted Excel** creates an `.xlsx` file with text descriptions and cheque numbers preserved, including leading zeroes. Import uses that same workbook through the existing Excel endpoint, with the same saved history, row editor and validation errors.

PDF/OCR processing happens in the browser; no PDF or image is sent to a third-party OCR service. Only the extracted workbook is uploaded to the app when importing. Scan state and the original PDF link are cleared on logout. Named statement profiles are unchanged.

Limits: 25 MB per PDF, 50 pages, 5,000 extracted rows and 120 seconds per page OCR recognition. Password-protected documents must be unlocked first. Use a recent desktop browser with WebAssembly and JavaScript modules. Review remains necessary: no OCR engine can guarantee perfect extraction from poor-quality scans.

## Hosting

Upload the complete `static/vendor/pdf-ocr/` directory together with the application assets. It contains pinned PDF.js 6.4.299, Tesseract.js 7.0.0, its WebAssembly core and English language data, and fflate 0.8.2. Licenses and SHA-256 hashes are in `PROVENANCE.md`. Files load only from the same origin; there is no CDN requirement or Python/Tesseract installation requirement on PHP hosting. The bundle is about 33 MB and is loaded when PDF import/OCR is used.

The supplied content security policy allows same-origin workers and WebAssembly (`wasm-unsafe-eval`), without enabling JavaScript `unsafe-eval` or third-party origins. PHP Apache hosting gets `.mjs` and `.wasm` MIME types from `.htaccess`. Python serves these types explicitly. For Nginx or other frontends, serve `.mjs` as `text/javascript` and `.wasm` as `application/wasm`; ensure any reverse-proxy CSP permits the same worker/WASM capability. Keep the English `.traineddata.gz` file available as a binary gzip file, not an automatically decompressed HTTP response.

Library documentation: [PDF.js](https://mozilla.github.io/pdf.js/) and [Tesseract local installation](https://github.com/naptha/tesseract.js/blob/master/docs/local-installation.md).
