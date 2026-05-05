# National Positions SEO Automation MVP

Internal upload-based SEO workflow app for Screaming Frog, Google Search Console, and Semrush exports.

## Run

```powershell
node server.js
```

Open `http://localhost:3000`.

## Implemented Tools

- Broken Link Fixer
- 404 Redirect Mapper
- Keyword Research from Semrush CSV/XLSX exports
- Image Missing Alt Text

## Notes

- This MVP recreates GPT workflow behavior through deterministic parsing, fuzzy URL matching, reusable prompt configs, and editable review tables.
- It does not call the ChatGPT GPT URLs directly.
- Semrush is CSV/XLSX upload only.
- WordPress, Shopify, direct CMS updates, and official Semrush API integration are intentionally deferred.
- Agency branding is editable in the app and saved locally in the browser.
- Client profiles are stored in `data/clients.json`, with uploaded logos and supporting files in `data/client-assets`.
- Saved clients can store domain, homepage, specialty, website link, Campaign Strategy Template link, shared Drive folder link, brand colors, notes, logo, and supporting files.
