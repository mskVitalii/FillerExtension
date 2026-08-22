# Filler

Chrome Extension (Manifest V3) that extracts job postings from the current tab, generates a
tailored cover letter with your own OpenAI key, and autofills the application form — all from
a Side Panel. See [spec_1.md](./spec_1.md) for the full product spec.

No backend: your OpenAI API key stays in `chrome.storage.local`, and your profile/CV/Personal
Legend/cover letters live in your own Google Drive `appDataFolder`.

## Development

```bash
cd extension
npm install
npm run dev      # Vite dev server + watch build into extension/dist
```

Load the extension:

1. Open `chrome://extensions`, enable Developer Mode.
2. "Load unpacked" → select `extension/dist`.

### Before it's usable

1. Create a Google Cloud project, enable the Drive API, configure an OAuth consent screen and a
   Chrome Extension OAuth client (spec section 29), then put the client ID into
   `extension/manifest.json` under `oauth2.client_id`.
2. Each user provides and pays for their own OpenAI API key at first run — nothing to configure
   for that.

### Testing autofill locally

Open [`test-pages/autofill-test.html`](./test-pages/autofill-test.html) — it covers plain
inputs, `aria-label`/`placeholder`-only fields, `autocomplete` tokens, `contenteditable`,
a custom combobox, a file input and a drag/drop zone (spec section 28).

## Project structure

See `extension/src/`:

- `background/` — service worker: message routing, context menus, extension lifecycle.
- `content/` — content script: job extraction, autofill, context-menu insert, file injection.
- `sidepanel/` — the React UI.
- `features/` — job-extraction, autofill, cover-letter, profile, openai, storage, google-drive, pdf.
- `types/` — shared Job/Profile/Application/message types.

## Status

MVP scaffold per spec sections 25-27. Google OAuth client ID and OpenAI API key are supplied
by each developer/user respectively — see above.
