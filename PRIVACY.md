# Privacy Policy — Filler

**Last updated:** August 23, 2026

Filler ("the extension") is a Chrome extension that helps you apply to jobs faster: it extracts job posting details from the page you're viewing, drafts a tailored cover letter using your own OpenAI API key, and autofills that information plus your saved profile into application forms.

This policy explains what data the extension handles, where it goes, and why.

## Summary

- Filler has **no backend server**. It runs entirely in your browser.
- Your data is sent only to services **you** configure and authenticate with your own credentials: **OpenAI** (your API key) and **your own Google Drive**.
- Filler does **not** sell, rent, or share your data with any third party for advertising, analytics, or any purpose unrelated to its stated function.
- Filler does **not** use your data to determine creditworthiness or for lending purposes.
- Filler does **not** include any analytics, tracking, or advertising SDKs.

## What data the extension handles

| Data | What it is | Where it's stored |
|---|---|---|
| Profile information | Name, email, phone, address, city, postal code, LinkedIn, GitHub, personal website, expected salary — the fields you fill in yourself | Locally (`chrome.storage.local`), synced to **your own** Google Drive `appDataFolder` |
| Résumé / CV | The PDF file you upload, plus text extracted from it locally | Locally, synced to **your own** Google Drive `appDataFolder` |
| OpenAI API key | The key you paste in during setup | Locally only (`chrome.storage.local`) — never transmitted anywhere except directly to `api.openai.com` as part of your own API requests |
| Google OAuth token | Issued by Google when you click "Connect Google" | Managed by Chrome's `chrome.identity` API; used only to call the Google Drive API on your behalf |
| Job posting content | Text/structured data extracted from the job page you're viewing when you use the extension | Processed locally; sent to `api.openai.com` (with your key) only when you generate/extract with AI assistance |
| Generated cover letters | The text drafted from your profile and the job posting | Stored locally and in your Google Drive `appDataFolder`, only when you use the extension |

Filler's Google Drive access is limited to the `drive.appdata` OAuth scope — a private, hidden storage area that only this extension can read or write, and that isn't visible in your regular Drive file list.

## Who receives data, and why

Filler talks to exactly two external services, both initiated by you and authenticated with your own credentials:

- **OpenAI (`api.openai.com`)** — receives job posting text and your profile/CV text (as needed) to extract structured job details and draft cover letters, using the API key you provide. Governed by [OpenAI's own privacy policy](https://openai.com/privacy).
- **Google Drive (`www.googleapis.com`)** — stores your profile, CV, and cover letter drafts in your own Drive account's app-data folder, using the OAuth token Chrome obtains when you connect your Google account. Governed by [Google's Privacy Policy](https://policies.google.com/privacy).

No data is ever sent to a server operated by the developer of this extension — there isn't one.

## Permissions

Filler requests the following Chrome permissions, each used only for its stated purpose:

- `storage` — save your API key and local caches of your profile/CV
- `activeTab` — read and fill the job posting / application page you're actively viewing
- `contextMenus` — let you insert a profile value into a focused field via right-click
- `sidePanel` — show the main Filler UI
- `tabs` — identify the active tab and route messages between the side panel and the page's content script
- `downloads` — save an exported cover letter PDF to your computer
- `identity` — obtain the Google OAuth token used to access your own Drive `appDataFolder`

Host permissions are limited to `api.openai.com` and `www.googleapis.com` — the two services described above.

## Data retention and control

- All locally stored data (API key, cached profile/CV, drafts) stays on your device and is removed when you uninstall the extension or clear its storage.
- Data stored in your Google Drive `appDataFolder` remains under your control; you can revoke Filler's access at any time from your [Google Account permissions](https://myaccount.google.com/permissions), which also deletes the extension's access to that folder.
- You can disconnect Google or delete your saved OpenAI key at any time from the extension's settings panel.

## Changes to this policy

If this policy changes, the "Last updated" date above will be revised. Material changes will be reflected here before they take effect.

## Contact

Questions about this policy can be sent to **msk.vitaly@gmail.com**.
