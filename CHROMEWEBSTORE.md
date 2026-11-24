# Chrome Web Store Listing — Filler

> Last Updated: 2026-11-24

Single source of truth for the Chrome Developer Dashboard: listing copy, permission
justifications, privacy disclosures and version history. Created when the LinkedIn collector was
added (the first change since the store listing that asks Chrome for access to a new site).
Not shipped in the zip (`make zip` packages `extension/dist` only).

## Store Listing

**Extension Name**
Filler

**Short Description**
Extract job postings, draft tailored cover letters with your OpenAI key, and autofill applications.

**Detailed Description**
Filler helps you apply to jobs faster from a side panel next to the posting.

It reads the job posting you're looking at (title, company, location, requirements), drafts a cover letter tailored to it and to your CV with your own OpenAI key, and fills the application form with your saved profile: name, contact details, CV upload, cover letter, and common application questions.

Job Search finds open roles that fit your CV through OpenAI web search, Tavily or Adzuna, with your own keys. Optionally, Filler can show "Add" buttons on LinkedIn's job search pages: one click saves the job links on your screen to Filler's list, and Filler can then look up the same job on the employer's own career site. Filler never clicks, scrolls, applies or sends anything on LinkedIn.

How to use it: open a job posting, click the Filler icon, and the side panel shows the posting, a cover letter draft and an Autofill button. Your profile, CVs and saved applications live in your own Google Drive's private app folder.

Privacy: Filler has no server. Your data goes only to the services you connect with your own credentials (OpenAI, Google Drive, and optionally Tavily, Adzuna, Anthropic). No analytics, no ads, no tracking.

**Category**
Productivity

**Single Purpose**
Helps the user apply to jobs: reads job postings, drafts cover letters and fills application forms.

**Primary Language**
English (UI also in German and Russian)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon | 128×128 PNG | ✅ Ready | `extension/public/icons/icon128.png` |
| Screenshot 1 | 1280×800 | 🟡 Needs update | side panel on a posting |
| Screenshot 2 | 1280×800 | ⬜ Not created | LinkedIn search page with Filler's "Add" buttons |

### Screenshot Notes
Screenshot 2 (new): a LinkedIn job search with the "Add all jobs from this page" box bottom-right and
"+ Add" pills on the cards, side panel open on Job Search → "From LinkedIn".

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Saves the user's OpenAI key, settings, local copies of their profile/CV and the list of job links they collected. |
| `activeTab` | permissions | When the user clicks the Filler icon, reads the job posting on that tab and fills its application form. |
| `scripting` | permissions | Injects the reading/filling script into the tab the user opened Filler on; and, only after the user switches it on, adds the "Add" buttons to LinkedIn's job search pages. |
| `contextMenus` | permissions | Right-click menu to insert a saved profile value into the focused form field. |
| `sidePanel` | permissions | The extension's whole UI is a side panel next to the posting. |
| `tabs` | permissions | Keeps the side panel bound to the tab it was opened on and routes its requests to that tab; finds open LinkedIn tabs to show the buttons without a reload after the user switched them on. |
| `downloads` | permissions | Saves an exported cover letter / adapted CV as a PDF. |
| `identity` | permissions | Google sign-in to store the user's profile, CVs and applications in their own Drive app folder. |
| `https://www.googleapis.com/*` | host_permissions | Google Drive API, the user's own private app folder. |
| `https://api.openai.com/*` | host_permissions | Cover letters, posting analysis and answers, with the user's own OpenAI key. |
| `https://api.tavily.com/*` | host_permissions | Job Search through Tavily with the user's own key; also finds an employer's own posting for a job collected on LinkedIn. |
| `https://api.adzuna.com/*` | host_permissions | Job Search through Adzuna with the user's own key. |
| `https://*/*`, `http://*/*` | optional_host_permissions | Requested at the moment of use, per site, with Chrome's prompt: `https://rest.arbeitsagentur.de/*` when the user turns on the Arbeitsagentur job search; an application form in an embedded frame on another domain; the user's local agent on `127.0.0.1`; `https://www.linkedin.com/*` when the user switches on the LinkedIn "Add" buttons. Nothing is granted at install. |

The LinkedIn buttons are deliberately not a manifest `content_scripts` entry: that would ask for
LinkedIn access at install for every user. The script is registered only after the user grants
`www.linkedin.com` from the side panel and switches the buttons on, and unregistered when they
switch them off. Install-time permissions did not change with this feature.

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** Yes — it handles the user's own data on their behalf; none of it reaches the developer.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | Yes (profile the user types in) | To the user's own Google Drive; to OpenAI with the user's key when drafting | Filling applications, drafting cover letters | Only the services the user connects |
| Health info | No | | | |
| Financial info | No (expected salary only, if the user enters it) | Same as profile | Filling applications | No |
| Authentication info | API keys the user enters | Only to their own provider in its requests | Calling the user's own accounts | No |
| Personal communications | No | | | |
| Location | City/country from the profile | Same as profile | Filling applications, job search | No |
| Web history | No | | | |
| User activity | No | | | |
| Website content | Job postings the user opens; LinkedIn job links/titles the user clicks "Add" on | Posting text to OpenAI with the user's key; a collected job's title/company/city to Tavily only on "Find employer's posting" | Cover letters, job search | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Privacy Policy

**Privacy Policy URL**
The repository's `PRIVACY.md` (published URL: fill in the one the store listing already uses).

## Developer Info

**Contact Email**
See `PRIVACY.md` → Contact.

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.1.18 | 2026-11-24 | Optional LinkedIn job-link collection: "Add" buttons on LinkedIn job search pages (off by default; asks for `www.linkedin.com` access from the side panel), "Find employer's posting". No new install-time permission. | Draft |

## Review Notes

### Known Issues / Limitations
- LinkedIn's results list only renders the cards near the viewport; the buttons collect what is on
  screen and say so ("N found on this page; scroll or open the next page to collect more"). This is
  deliberate — the extension never scrolls or paginates LinkedIn.
- A reviewer testing the LinkedIn buttons needs a LinkedIn account and must switch them on in
  Job Search → "From LinkedIn" first.

### Rejection History
None recorded.
