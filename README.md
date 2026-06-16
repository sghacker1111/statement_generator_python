# Web Statement Generator

This folder contains a separate web-based version of the statement generator. It does not change the existing Windows desktop app.

## Run locally

```powershell
cd "C:\Users\SGHACKER\manimations\Web Statement Generator"
python app.py --open
```

Or double-click:

`start_web_statement_generator.bat`

Then open:

`http://127.0.0.1:8050/`

## What is included

- Browser UI with Account, Statement Rules, Texts & Names, Holidays & Saturdays, and Export sections
- Top-right `Create Stat` button inside the web app
- Persistent holiday and Saturday management saved in `web_statement_generator_state.json`
- Template-based Excel and Word export using the same copied generator/export logic
- Normal Excel and Word export fallback
- Browser profile save/load using local storage
- Website button snippet in `site_integration`

## Important template export note

Template-based Excel and Word export uses Microsoft Office automation, the same way the Windows app does.

- `Normal export` works directly from this web app.
- `Template export` needs a Windows environment where Microsoft Excel and Word are installed and available to the running app session.
- On many shared hosting or Linux hosting environments, only the normal export will work unless you move template export to a Windows server setup that supports Office automation.

## Website integration

If your website is hosted separately, add the snippet from:

`site_integration/README.md`

That script adds a top-right `Create Stat` button linking to the web app path.
