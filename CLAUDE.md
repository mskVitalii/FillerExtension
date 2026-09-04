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

## Commands

Run from the repo root via `make` (see `Makefile`), or `cd extension && npm run <script>` directly.

```bash
make install         # npm install in extension/
make dev              # vite dev server, watch-builds into extension/dist
make build             # tsc --noEmit + vite build (sidepanel) + vite build (content script)
make typecheck        # tsc --noEmit only
make lint              # eslint .
make lint-fix          # eslint . --fix
make test              # vitest run — the autofill-engine regression suite (jsdom, no browser needed)
make clean             # remove extension/dist and extension.zip
make zip               # build, then package extension/dist into extension.zip (repo root) — alias: make package
make version           # print current version (extension/package.json)
make version-patch     # bump patch version in package.json + manifest.json (+ lockfile), e.g. 0.2.0 -> 0.2.1
make version-minor     # bump minor version
make version-major     # bump major version
make release            # clean + install + build + zip
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
against a second, dev-only OAuth client. Production builds (used for the CWS package) are
untouched whenever that file is absent.

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

### Job extraction: two-stage, DOM-first

`src/features/job-extraction/extractor.ts` merges a JSON-LD structured-data pass
(`json-ld.ts`) with a generic DOM heuristics pass (`dom-heuristics.ts`); JSON-LD wins
per-field when present. `isExtractionSufficient()` gates whether the background falls back to
an AI extraction pass (`job-extraction/ai-fallback.ts`, via `router.ts`'s `GET_JOB` handler)
when the DOM/JSON-LD pass didn't produce enough signal (missing position/company, or a short
description).

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
