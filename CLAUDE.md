# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

"Filler" — a Manifest V3 Chrome extension that extracts job postings from the current tab,
drafts a tailored cover letter via the user's own OpenAI key, and autofills the application
form, all from a Side Panel. No backend: the OpenAI key lives in `chrome.storage.local`, and
the user's profile/CV/Personal Legend/cover letters/applications live in their own Google
Drive `appDataFolder`. See [spec_1.md](./spec_1.md) (full spec), [spec_2.md](./spec_2.md),
[spec_3.md](./spec_3.md) for feature-level detail, and [PRIVACY.md](./PRIVACY.md).

The actual project lives in `extension/` — `cd extension` before running any command below.

## Skills

Two Claude Code skills are installed at `extension/.claude/skills/` (via `npx
modern-web-guidance@latest install`, per https://developer.chrome.com/docs/extensions/ai/build-with-ai)
and should be used whenever they apply, not just left to auto-trigger:

- **`chrome-extensions`** — Manifest V3 pitfalls/best practices specific to this codebase's
  shape: side panel activation (`chrome.sidePanel.open()`/`setPanelBehavior`, not just declaring
  `side_panel` in the manifest), service-worker statelessness, CSP/sandbox for code execution,
  `activeTab` vs `tabs`+`host_permissions` (this project already needs the latter since actions
  fire from the Side Panel, not a direct user gesture), message-passing (`return true` for async
  `onMessage`), permissions. Use it whenever touching `manifest.json`, any `chrome.*` API, or the
  content-script/background/side-panel message contract. It also owns `CHROMEWEBSTORE.md` (store
  listing copy, permission justifications, privacy disclosures, pre-publish checklist) — that
  file doesn't exist in this repo yet; create it via this skill the first time publishing,
  re-publishing, or a Chrome Web Store review rejection comes up.
- **`modern-web-guidance`** — general web-platform best-practices search
  (`npx modern-web-guidance search "<query>"` then `retrieve <id>`), not extension-specific. Use
  it before building new Side Panel UI/CSS (layout, forms, animations) so it doesn't ship an
  ad-hoc pattern where a standard one already exists.

## Commands

Run from the repo root via `make` (see `Makefile`), or `cd extension && npm run <script>` directly.

```bash
make install         # npm install in extension/
make dev              # vite dev server, watch-builds into extension/dist
make build             # tsc --noEmit + vite build (sidepanel) + vite build (content script) — honors extension/.env.local dev OAuth override
make build-release     # same, but built with --mode release — ignores extension/.env.local, always ships manifest.json's real prod OAuth client
make typecheck        # tsc --noEmit only
make lint              # eslint .
make lint-fix          # eslint . --fix
make test              # vitest run — the autofill-engine regression suite (jsdom, no browser needed)
make clean             # remove extension/dist and extension.zip
make zip               # build-release, then package extension/dist into extension.zip (repo root) — alias: make package
make version           # print current version (extension/package.json)
make version-patch     # bump patch version in package.json + manifest.json (+ lockfile), e.g. 0.2.0 -> 0.2.1
make version-minor     # bump minor version
make version-major     # bump major version
make release            # clean + install + zip (release-mode build)
make publish            # bump version (PART=patch|minor|major, default patch) + release + zip, in one command — this is "cut a new release"
```

### Automated regression suite (`make test`)

`extension/test/*.test.ts` (Vitest + jsdom) drives the real content-script modules —
`autofillDocument`, `injectFileIntoPage`, `decomposeContainer`/`fillAnswersByLocator`,
`detectCustomQuestions`/`fillCustomQuestionAnswers`, `detectCheckboxes`/`applyCheckboxDecisions`,
`resolvePhoneFill` — directly against `test-pages/autofill-test.html` (`test/load-fixture.ts`
loads it verbatim into jsdom's `document`, so a fix verified here is verified against exactly
what a manual click-through in Chrome also exercises) or small synthetic DOM fragments. No
Chrome, no OpenAI key, no Google Drive login — nothing that reaches the network. `test/setup.ts`
stubs the handful of browser APIs jsdom doesn't implement (`offsetParent`/layout,
`isContentEditable`, `DataTransfer`/`DragEvent`, `input.files`); read its comments before adding
a test that hits a new one. `make test` (or `cd extension && npm test`) runs it; `npm run
test:watch` for a watch loop. This is deliberately narrower than the manual test page: it covers
the DOM/engine layer where the label-detection/phone-format/file-targeting/radio-group bugs
actually live, not the React Side Panel UI itself (message-passing plumbing, AI calls, Drive/OAuth)
— that still needs a manual run through `test-pages/autofill-test.html` per the note below.

Manual autofill testing page: [test-pages/autofill-test.html](./test-pages/autofill-test.html) —
covers plain inputs, `aria-label`/`placeholder`-only fields, `autocomplete` tokens,
`contenteditable`, a custom combobox, a file input and a drag/drop zone, application questions,
consent checkboxes, and radio-group questions (via "Pick fields on page").

Loading the built extension: `chrome://extensions` → enable Developer Mode → "Load unpacked" →
select `extension/dist`.

Before it's usable: a Google Cloud project with Drive API enabled, an OAuth consent screen and
a Chrome Extension OAuth client must be configured, with the client ID placed in
`extension/manifest.json` under `oauth2.client_id`. Each user supplies their own OpenAI API key
at first run.

## Architecture

### Three separate build targets, one manifest

`extension/vite.config.ts` builds the side panel (`src/sidepanel/index.html`) via
`@crxjs/vite-plugin`, which also generates `manifest.json` and the background service worker
bundle. `extension/vite.content.config.ts` builds the content script
(`src/content/index.ts`) *separately* as a single self-contained IIFE (`content-script.js`) —
deliberately **not** declared in `manifest.json`'s `content_scripts`, because that would
auto-inject it on every page and trigger Chrome Web Store's "broad host permissions" review
flag. Instead `background/inject-content-script.ts` injects that exact file on demand via
`chrome.scripting.executeScript`, gated by the `activeTab` grant from a user gesture (icon
click or context-menu use). `make build` runs both Vite configs in sequence; `make zip` then
packages the combined `extension/dist` output.

`extension/vite.config.ts` also swaps in a dev-only Google OAuth client id from
`VITE_DEV_GOOGLE_CLIENT_ID` (in a gitignored `extension/.env.local`) when present — the
Chrome Web Store item's OAuth client is registered against the *published* extension ID, which
never matches a locally "Load unpacked" build's ID, so Google sign-in only works locally
against a second, dev-only OAuth client. This swap is skipped whenever Vite runs with
`--mode release` (i.e. `npm run build:release`, used by `make build-release`/`make
zip`/`make publish`), regardless of whether `.env.local` is present on disk — so a
release/CWS build always ships `manifest.json`'s own `oauth2.client_id` (the real prod
client) untouched, even if a developer's local `.env.local` still has the dev override set.

### Message-passing: Side Panel <-> Background <-> Content Script

Three runtime contexts communicate exclusively through the discriminated union
`RuntimeMessage` in `src/types/messages.ts` — never send untyped payloads. The service worker
(`src/background/index.ts`) is the router: it must not hold application state only in memory
(Chrome can unload it at any time), so everything is re-derived from `chrome.storage`/Drive on
each event. `src/background/router.ts` dispatches by `message.type`; requests targeting a
specific tab carry an explicit `tabId` supplied by the Side Panel (which tracks the active tab
itself via `useActiveTab`) rather than the background re-querying "the active tab" — this
avoids attributing a slow response to whichever tab happens to be active by the time it
resolves, if the user switched tabs meanwhile. `src/content/index.ts` is the single message
entry point for the content script and owns all DOM access — extraction, autofill,
context-menu inserts, file injection; it guards against duplicate listener registration when
re-injected into the same tab (`window.__fillerContentScriptLoaded`).

The Side Panel is *contextual*, not the manifest's default per-window behavior: it's disabled
for every tab by default and only enabled for the specific tab whose action icon was clicked
(`chrome.sidePanel.setOptions({ tabId, ... })` in `background/index.ts`), so it doesn't keep
showing stale content from a previous tab after the user switches tabs.

### Job extraction: three-stage, DOM-first

`src/features/job-extraction/extractor.ts` overlays three passes, lowest to highest
confidence: a generic DOM heuristics pass (`dom-heuristics.ts`) → a site-specific extractor
from `job-extraction/sites/` when one recognises the page (`sites/index.ts` dispatches;
`sites/workatastartup.ts` handles Y Combinator's Work at a Startup, which ships no JSON-LD and
fuses role+company into `og:title`) → a JSON-LD structured-data pass (`json-ld.ts`). Each
overlay fills only its non-empty fields via `applyOverlay()`. Add a site by dropping a module
in `sites/` and appending it to `SITE_EXTRACTORS`. `isExtractionSufficient()` gates whether
the background falls back to an AI extraction pass (`job-extraction/ai-fallback.ts`, via
`router.ts`'s `GET_JOB` handler) when the combined pass didn't produce enough signal (missing
position/company, or a short description).

### Storage: three tiers with different trust/durability

- `chrome.storage.local` (`features/storage/local.ts`) — the OpenAI API key, plus local
  caches of Drive-backed documents (profile, CV meta, personal legend, custom fields, last
  cover letter). Never put large documents only here.
- `chrome.storage.sync` (`features/storage/sync.ts`) — small cross-device preferences only
  (e.g. `autofillOnOpen`, `pdfFontSize`). Never documents or secrets.
- Google Drive `appDataFolder` (`features/google-drive/`) — source of truth for profile, CV,
  Personal Legend and saved applications (`features/applications/repository.ts`). Repository
  functions in `features/profile/repository.ts` and `features/applications/repository.ts`
  follow a consistent cache-then-Drive pattern: read local cache first, fall back to Drive,
  populate the cache on hit, fall through to an empty value when Google isn't connected yet.

Applications are keyed by `applicationIdForUrl(job.url)` (`features/applications/id.ts`) so
re-generating or editing a cover letter for the same job URL updates the existing Drive record
(`applications/<id>.json`) instead of creating a duplicate.

### Adapt CV tab (per-CV templates)

The CV file itself is the template — the extension never rebuilds a CV, it only fills the
`{{placeholders}}` the user typed into it (a CV without any has nothing to adapt, and the tab
shows `PlaceholderExplainer` instead). Placeholder definitions are stored per CV in
`types/cv-template.ts` / Drive `cvTemplates.json`, keyed by `CvMeta.id`. Each has a description
(the AI's instruction), variants that can span several lines, and a mode: `choice` (always one of
the variants) or `free` (the variants are only examples). A newly found placeholder starts from
`features/cv-template/defaults.ts` when its name is a known one (`city`, `country`,
`job_position`, `company`, `main_language`, `keywords`, …); known ones like `city`/`company` are
also filled offline straight from the posting (`valueFromJob`). The format comes from the file
(`cvFormat` in `cv-template/repository.ts`), and the template's text is always `CvMeta.text`:

- **`.docx` CV (`docx`).** `features/cv-template/docx.ts` (fflate + DOMParser) rewrites only the
  `<w:t>` text of the placeholders. It handles placeholders that Word split across runs, and
  every other part of the package stays byte-identical. No in-browser library turns that `.docx`
  into a PDF with a real Word layout, so `google-drive/convert.ts` uploads the filled `.docx` as a
  temporary Google Doc, exports it as PDF and deletes it. `files.export` doesn't accept
  `drive.appdata`, so that call asks for `drive.file` *incrementally* through
  `getAuthToken({ scopes })`. Keep `drive.file` out of `manifest.json`'s `oauth2.scopes`: adding
  it there makes every existing user's silent token lookup fail until they re-consent. Known gap:
  Google has no Calibri Light, so it renders as Calibri.
- **PDF CV (`pdf`).** `features/cv-template/pdf.ts` (pdf-lib) edits the PDF in place: it parses
  the content streams, decodes text through each font's ToUnicode/encoding, finds `{{name}}`
  (even kerned apart mid-word), and rewrites only the operators drawing it. The value reuses the
  PDF's own embedded font when the subset has every glyph (codes drawn elsewhere, or a Type1
  CharSet); otherwise a Standard 14 stand-in of the same kind (serif/sans/mono, bold, italic), or
  Inter outside WinAnsi. A layout pass keeps lines natural: text flowing in the same TJ, or a
  chunk placed flush against the edit by its own Td/Tm (Chrome, Word), moves by the width change;
  a wide kern (LaTeX `\hfill`) or a distant chunk (right-aligned date) absorbs it instead. Link
  annotations and TeX-drawn link underlines don't move.
- **LaTeX CV (`latex`).** An Overleaf project .zip or a single .tex, stored as uploaded.
  Placeholders are written `\{\{city\}\}` (`job\_position`), so the compiled PDF shows
  `{{city}}`. `features/cv-template/latex.ts` fills the main source (a value that is one of the
  variable's own variants goes in verbatim, anything else is LaTeX-escaped) and compiles via
  LaTeX-On-HTTP (`latex.ytotech.com`, CORS open, so no host permission) — no browser TeX engine
  works without a TeX Live mirror (SwiftLaTeX's is gone). `prepareCvFile` (`lib/cv-text.ts`)
  compiles once on upload: `CvMeta.text` comes from that PDF, which is also kept as Drive
  `cv-<id>.compiled.pdf` and is what `getCvAttachmentFile` hands to the plain "Attach CV".

`features/cv-template/adapt.ts` is shared by `CvAdaptPanel.tsx` and MainView's "Preview/Attach/
Export adapted CV" buttons. It holds the per-tab, per-CV values (session storage `cvAdapt:<tabId>`),
the `SUGGEST_CV_VALUES` round-trip and the rendering (`renderAdaptedCv` → `{ file, notes }`, plus
an in-memory cache of rendered PDFs). Every adapted PDF produced (preview, attach or download) is
also kept with its posting's application, via `recordAdaptedCv` → `applications/repository.ts`
`saveAdaptedCv`. The record is `Application.adaptedCv`, and the file is Drive `adaptedCv/<id>.pdf`.
It deliberately lives outside `applications/`, because `listApplicationFiles` matches on that
name. The Applications list previews or downloads it. Writes to one application go through
`updateApplication`'s per-id queue, because the cover-letter autosave and an adapted-CV save can
hit the same record at once. Before any AI call, `findOptionsInPosting` preselects variants that
appear verbatim in the posting, and a `choice` answer from the AI that isn't one of the variants
falls back to that offline value. Picking a CV in the Adapt CV tab also makes it the active CV
everywhere else.

`test/cv-template-pdf.test.ts` fills two synthetic fixtures in `test/pdf-fixtures/` (a pdfTeX PDF
and a Chrome "Save as PDF" of `chrome-placeholders.html`) and checks text and positions through
pdf.js, which works under jsdom. jsdom does corrupt react-pdf's flate streams, so a react-pdf PDF
written from a jsdom test won't open.

### OpenAI usage

All AI requests go directly from the extension to OpenAI's Responses API using the user's own
key (`features/openai/client.ts`) — the key never leaves the extension runtime except as the
`Authorization` header of that call. Two model tiers are used deliberately:
`MODEL_TERRA` for text that goes straight into the application (cover letters), `MODEL_LUNA`
for support tasks (job analysis, translation, custom-question answers) where latency matters
more than nuance. Structured output is requested via `text.format: json_schema` with a caller
supplied schema + `parse()` function (see `requestStructured<T>`).

### Path alias

`@/*` resolves to `extension/src/*` (configured in both `tsconfig.json` and each Vite config)
— always import via `@/...` rather than relative paths across feature boundaries.
