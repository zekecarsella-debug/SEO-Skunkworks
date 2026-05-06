# National Positions SEO Automation MVP

Internal upload-based SEO workflow app for Screaming Frog, Google Search Console, and Semrush exports.

## Run

```powershell
node server.js
```

Open `http://localhost:3000`.

For local OAuth/AI testing, copy `.env.example` to `.env`, fill the Google/OpenAI values, then restart `node server.js`.

Google OAuth local redirect URI:

```text
http://localhost:3000/auth/google/callback
```

Render redirect URI:

```text
https://YOUR-RENDER-DOMAIN/auth/google/callback
```

## Implemented Tools

- Broken Link Fixer
- 404 Redirect Mapper
- Keyword Research from Semrush CSV/XLSX exports
- Image Missing Alt Text
- Canonical Fixes

## Optional Environment Variables

- `OPENAI_API_KEY`
- `OPENAI_MODEL` defaults to `gpt-5.3`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SESSION_SECRET`
- `ALLOWED_EMAIL_DOMAIN` defaults to `nationalpositions.com`
- `ALLOWED_EMAILS` optional comma-separated allowlist

## Notes

- This MVP recreates GPT workflow behavior through deterministic parsing, fuzzy URL matching, reusable prompt configs, and editable review tables.
- It does not call the ChatGPT GPT URLs directly.
- Semrush is CSV/XLSX upload only.
- WordPress, Shopify, direct CMS updates, and official Semrush API integration are intentionally deferred.
- Agency branding is editable in the app and saved locally in the browser.
- Client profiles are stored in `data/clients.json`, with uploaded logos and supporting files in `data/client-assets`.
- Saved clients can store domain, homepage, specialty, website link, Campaign Strategy Template link, shared Drive folder link, brand colors, notes, logo, and supporting files.
