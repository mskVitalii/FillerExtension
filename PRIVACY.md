# Privacy Policy — Filler

**Last updated:** November 24, 2026

Filler ("the extension") is a Chrome extension that helps you apply to jobs faster: it extracts job posting details from the page you're viewing, drafts a tailored cover letter using your own OpenAI API key, and autofills that information plus your saved profile into application forms.

This policy explains what data the extension handles, where it goes, and why.

## Summary

- Filler has **no backend server**. It runs entirely in your browser.
- Your data is sent only to services **you** configure and authenticate with your own credentials: **OpenAI** (your API key) and **your own Google Drive** — plus, only if you upload a LaTeX CV, the LaTeX compiler service described below.
- Filler does **not** sell, rent, or share your data with any third party for advertising, analytics, or any purpose unrelated to its stated function.
- Filler does **not** use your data to determine creditworthiness or for lending purposes.
- Filler does **not** include any analytics, tracking, or advertising SDKs.

## What data the extension handles

| Data | What it is | Where it's stored |
|---|---|---|
| Profile information | Name, email, phone, address, city, postal code, LinkedIn, GitHub, personal website, expected salary — the fields you fill in yourself | Locally (`chrome.storage.local`), synced to **your own** Google Drive `appDataFolder` |
| Résumé / CV | The PDF, Word (.docx) or LaTeX project (.zip / .tex) you upload, plus, for a LaTeX CV, its compiled PDF, plus text extracted from it locally, and the `{{placeholder}}` settings you define for adapting it per job posting | Locally, synced to **your own** Google Drive `appDataFolder` |
| OpenAI API key | The key you paste in during setup | Locally only (`chrome.storage.local`) — never transmitted anywhere except directly to `api.openai.com` as part of your own API requests |
| Anthropic API key (optional) | The key you paste in Settings → "Fallback to Claude", if you do | Locally only (`chrome.storage.local`) — never transmitted anywhere except directly to `api.anthropic.com` as part of your own API requests |
| Google OAuth token | Issued by Google when you click "Connect Google" | Managed by Chrome's `chrome.identity` API; used only to call the Google Drive API on your behalf |
| Job posting content | Text/structured data extracted from the job page you're viewing when you use the extension | Processed locally; sent to `api.openai.com` (with your key) only when you generate/extract with AI assistance |
| Generated cover letters | The text drafted from your profile and the job posting | Stored locally and in your Google Drive `appDataFolder`, only when you use the extension |
| LinkedIn job links (optional) | Only if you switch on "Show Filler's buttons on LinkedIn" and click "Add": the job's link (`https://www.linkedin.com/jobs/view/<id>/`), title, company and location as shown on the card you added | Locally only (`chrome.storage.local`); never sent to LinkedIn or to Google Drive |
| Adapted CVs | The PDF of your CV as adapted for a specific job posting (the one you last previewed, attached or downloaded for it), plus the values it was filled with | Your Google Drive `appDataFolder`, next to that posting's application; deleted together with it |

Filler's Google Drive access is limited to the `drive.appdata` OAuth scope — a private, hidden storage area that only this extension can read or write, and that isn't visible in your regular Drive file list.

Only if you export an adapted Word CV as PDF, Filler asks once for one more narrow scope, `drive.file` (access only to files Filler itself creates, never to your other Drive files). It uses it to upload that adapted CV as a temporary Google Doc, let Google Docs convert it to PDF, and delete the temporary file immediately afterwards — whether or not the conversion succeeded. If you never export a Word CV as PDF, this scope is never requested.

## Who receives data, and why

Filler talks only to the external services below, both initiated by you and authenticated with your own credentials:

- **OpenAI (`api.openai.com`)** — receives job posting text and your profile/CV text (as needed) to extract structured job details and draft cover letters, using the API key you provide. Governed by [OpenAI's own privacy policy](https://openai.com/privacy).
- **Anthropic (`api.anthropic.com`)** — only if you add an Anthropic key in Settings → "Fallback to Claude". Then, depending on the option you pick there, a request OpenAI couldn't answer (overloaded, unreachable, or any error), or every request, goes to Claude instead, with the same content OpenAI would have received, using your key. Governed by [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy).
- **OpenRouter (`openrouter.ai`)** — at most once a day Filler downloads OpenRouter's public model list (`GET https://openrouter.ai/api/v1/models`) to know which OpenAI and Claude models exist, their list prices and the request options each accepts. The request carries no API key and none of your data; Filler never sends prompts or content to OpenRouter.
- **Google Drive (`www.googleapis.com`)** — stores your profile, CV, and cover letter drafts in your own Drive account's app-data folder, using the OAuth token Chrome obtains when you connect your Google account. Governed by [Google's Privacy Policy](https://policies.google.com/privacy).
- **Bundesagentur für Arbeit — Jobsuche (`rest.arbeitsagentur.de`)** — only when you search for jobs with a location in Germany and leave "Also search the Arbeitsagentur" on in Settings (or pick it as the provider). Filler sends the search terms, the city and the filters of that search (remote only, "no agencies") to the German Federal Employment Agency's public job-board API and fetches the details of the postings it returns. The requests carry no account, no key of yours and none of your profile or CV data; the API's fixed public client id (`jobboerse-jobsuche`) is sent as a header. Governed by the [Bundesagentur's privacy notice](https://www.arbeitsagentur.de/datenschutz).
- **LaTeX-On-HTTP (`latex.ytotech.com`)** — only if you upload a LaTeX CV. Browsers can't run a full TeX installation, so the files of your LaTeX project (sources, photo, other files in the .zip), with the placeholders filled in, are sent to this free open-source compile service ([source](https://github.com/YtoTech/latex-on-http)) each time the CV is compiled: once on upload, and when you preview, attach or download an adapted version. It returns the PDF. PDF and Word CVs are never sent there.

- **Tavily (`api.tavily.com`)** and **Adzuna (`api.adzuna.com`)** — only if you add their keys in Settings and run a Job Search with them: your search terms and location, and, for "Find employer's posting" on a job collected from LinkedIn, that job's title, company and city. Governed by their own privacy policies.
- **Your own local Filler agent (`127.0.0.1`)** — only if you connect the optional desktop agent: a posting you hand to it (its URL, title, company, location), plus the same data export as Settings → Export all data. It runs on your computer; nothing goes over the network. A LinkedIn link is never handed to it — only the employer's own posting.

No data is ever sent to a server operated by the developer of this extension — there isn't one.

## LinkedIn (optional, off by default)

If you switch on "Show Filler's buttons on LinkedIn" in Job Search, Chrome asks you to allow Filler on `www.linkedin.com`. Filler then shows an "Add all jobs from this page" button and a small "Add" button on each job card on LinkedIn's job search, collection and job pages. When you click one, Filler reads the job links (and the title, company and location) that are already displayed on your screen and saves them in your browser.

Filler never sends anything to LinkedIn and never acts on LinkedIn for you: it makes no requests to LinkedIn, does not read your profile, messages, connections or feed, and does not click, scroll, open, submit or apply to anything there (no Easy Apply). Pages outside the job pages are left alone. Switching the buttons off removes them; you can also withdraw the site access in `chrome://extensions`.

## Permissions

Filler requests the following Chrome permissions, each used only for its stated purpose:

- `storage` — save your API key and local caches of your profile/CV
- `activeTab` — read and fill the job posting / application page you're actively viewing
- `contextMenus` — let you insert a profile value into a focused field via right-click
- `sidePanel` — show the main Filler UI
- `tabs` — identify the active tab and route messages between the side panel and the page's content script
- `downloads` — save an exported cover letter PDF to your computer
- `identity` — obtain the Google OAuth token used to access your own Drive `appDataFolder`
- `scripting` — read and fill the page you opened Filler on, and, only after you switch it on, show the LinkedIn "Add" buttons on LinkedIn's job pages

Host permissions granted at install are limited to `api.openai.com`, `www.googleapis.com`, `api.tavily.com` and `api.adzuna.com` — services described above. Anthropic's API and OpenRouter's public model list accept requests straight from a browser, so neither the optional Claude fallback nor the model list needs a host permission.

Optional host permissions are requested only when you use the feature that needs them, with Chrome's own prompt, and you can withdraw each any time in Chrome's extension settings: `rest.arbeitsagentur.de` when you turn on the Arbeitsagentur search (its API doesn't accept requests from other websites' or extensions' origins without it), a site whose application form sits in an embedded frame (for autofill), your local agent (`127.0.0.1`), and `www.linkedin.com` (for the LinkedIn buttons).

## Data retention and control

- All locally stored data (API key, cached profile/CV, drafts) stays on your device and is removed when you uninstall the extension or clear its storage.
- Data stored in your Google Drive `appDataFolder` remains under your control; you can revoke Filler's access at any time from your [Google Account permissions](https://myaccount.google.com/permissions), which also deletes the extension's access to that folder.
- You can disconnect Google or delete your saved OpenAI key at any time from the extension's settings panel.

## Changes to this policy

If this policy changes, the "Last updated" date above will be revised. Material changes will be reflected here before they take effect.

## Contact

Questions about this policy can be sent to **msk.vitaly@gmail.com**.
