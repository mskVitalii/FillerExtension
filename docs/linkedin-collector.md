# LinkedIn job-link collector

Extension only (`extension/src/features/linkedin-collector/`, entry `src/content/linkedin-collector.ts`,
built by `extension/vite.linkedin.config.ts` into `dist/linkedin-collector.js`). FillerAgent, the
desktop app that drives a browser, imports none of it and must never touch LinkedIn.

## What it does

On `linkedin.com/jobs/search*`, `/jobs/search-results*`, `/jobs/collections*` and `/jobs/view/<id>`:

- a floating box (bottom-right) with **"Add all jobs from this page"** (on a single posting: **"Add this job"**);
- a small **"+ Add"** pill on each job card that is on screen (bottom-right of the card).

A click saves canonical links, `https://www.linkedin.com/jobs/view/<id>/`, deduped by job id, plus
the title/company/location the card shows, to `chrome.storage.local` (`linkedinCollected`). They
appear in the Side Panel under **Job Search → From LinkedIn**, with:

- **Find employer's posting**: one Tavily search (`"<title>" "<company>" <city> job`, ATS hosts
  preferred, job boards excluded), ranked by title-word overlap and the company being named. Up to 3
  candidates, never a job board.
- **Send to agent** on a candidate: hands the *employer's* URL to the local FillerAgent queue
  (`applyViaAgent`), after a sync, like "Apply via AI agent". The agent then applies on the ATS.

## "Apply via AI agent" on a LinkedIn job

On a LinkedIn job (search pane or `/jobs/view/`), the agent button doesn't send the LinkedIn page.
It asks the tab's content script (`GET_LINKEDIN_APPLY_URL` → `apply-link.ts` `employerApplyUrl`)
for the href of the job's own "Apply ↗" link, as rendered. That link is never clicked. LinkedIn wraps
the employer's page as `https://www.linkedin.com/safety/go/?url=<employer URL>&urlhash=…` (also
`/redir/redirect/?url=`, `/jobs/view/externalApply/<id>?url=`). The `url` parameter is decoded,
`utm_*`/`trk`/`lipi`… are dropped, and that URL is what the agent checks and opens, directly, never
through LinkedIn. Links inside the description ("About the job") don't count. An Easy Apply job has
no such link: the button stays off and says so.

## Where to switch it on

Off by default. A banner on LinkedIn job pages in the main panel view
(`components/LinkedInCollectorBanner.tsx`) has the "Show Filler's buttons on LinkedIn" button. So
does Job Search → From LinkedIn.

## Safety rules (the account matters more than any link)

- Reads only DOM LinkedIn has already rendered, only on a user click. No LinkedIn/voyager API call,
  no `fetch` of a LinkedIn page, no click/focus/scroll/submit on LinkedIn's elements, no Easy Apply,
  no pagination, no timers/polling. The built bundle is checked for `fetch(`, `XMLHttpRequest`,
  `.click()`, `scrollTo`/`scrollIntoView`, `setInterval`, `dispatchEvent`: none.
- One MutationObserver (debounced 400 ms) re-finds cards to place the pills and re-attaches the
  host; passive scroll/resize listeners move the pills with their cards (one rAF per frame).
- One host element (`<filler-linkedin>`, closed shadow root, top-layer popover). Nothing is inserted
  into LinkedIn's own markup; our clicks are stopped at the shadow root, so LinkedIn's document
  listeners never see them. No `web_accessible_resources`, so a page can't probe for the extension.
- The virtualized list is not scrolled for the user: the box says
  "N found on this page; scroll or open the next page to collect more."
- `applyViaAgent` refuses any `linkedin.*` URL (in the posting URL or the job's own URL), on top of
  FillerAgent's own `blockedHosts`.

Residual risk, stated plainly: LinkedIn can see that an extra element sits in its page (it can't see
inside the closed shadow root) — the footprint is one element, only on jobs pages, only for users
who switched it on.

## Permissions

No install-time change. `https://www.linkedin.com/*` is covered by the existing
`optional_host_permissions` (`https://*/*`). The Side Panel's **Show Filler's buttons on LinkedIn**
requests it with one click (first call of the click handler, for the user gesture) and sets
`linkedinCollector.enabled`. The background (`syncLinkedInCollector`) registers the script with
`chrome.scripting.registerContentScripts` only while **both** the permission and the switch hold, and
re-checks on install/update, browser start, `permissions.onAdded/onRemoved` and a change of the
switch. On registering it also injects into LinkedIn tabs already open; on switching off it
unregisters and tells open tabs to take the UI down (`LINKEDIN_COLLECTOR_OFF`).

Matches are the whole host (`https://www.linkedin.com/*`), not just `/jobs/*`: LinkedIn is a
single-page app, and a job search opened from the feed never reloads the page. Off the jobs pages
the script mounts nothing and only listens for navigation (`navigation` `navigatesuccess`, `popstate`).

## Decisions (made without the user, 2026-11-24)

1. **Source tag**: `linkedin` is a `JobSearchSource` (added by the Jobsuche change, next to the search
   providers; not a `JobSearchProvider`, so FillerAgent's autopilot queue, typed by provider, is
   untouched). A collected record carries `source: "linkedin"` and shows the LinkedIn chip
   (`SourceChips`); an employer posting found for it is `source: "linkedin"`, `sources: ["linkedin", "tavily"]`.
2. **No LinkedIn link to the agent**: the agent refuses job boards and must never open LinkedIn, so a
   LinkedIn lead reaches it only as the employer's own posting the user picked. Lookup is Tavily only
   (cheap, one request, no AI); without a Tavily key the panel says to add one.
3. **Explicit switch on top of the permission**: someone who already granted "all sites" for
   autofill doesn't get buttons on LinkedIn they never asked for.
4. **Single posting page**: "Add this job" adds that posting only; recommendation cards on it get
   their own "+ Add" pills.
5. **Selected job's pane**: on a list page, its details (title/company/location) fill gaps of its own
   card; the pane is never counted as a card, and jobs linked only from inside the pane aren't added.
6. **Storage**: `chrome.storage.local`, capped at 1000 (oldest dropped). Not Drive: links are leads,
   not documents.
7. **On-page strings**: en/de/ru picked from the browser language (the content script doesn't load
   the panel's i18n dictionaries).

## Tests

- `extension/test/linkedin-collector.test.ts` (jsdom) loads `test-pages/linkedin-jobs-test.html`:
  classic cards (nested `data-occludable-job-id` / `data-job-id`), an occluded card (id only),
  server-driven cards (no id attribute, `currentJobId` and slug links, a country subdomain), a guest
  card (`data-entity-urn`), duplicates, non-job links and a details pane. It also covers id parsing,
  the store's re-validation and merge, the employer ranking, the agent guard, and the on-page box
  (one host, nothing sent before a click, 6 jobs after, our click never reaches page listeners).
- Manual: `make build`, serve the repo root (`python3 -m http.server 8000`), open
  `http://localhost:8000/test-pages/linkedin-jobs-test.html` — it stubs `chrome.runtime` and loads
  `extension/dist/linkedin-collector.js` as if on a LinkedIn search page.
- Not verified: a real LinkedIn page. LinkedIn's markup changes often (class names are obfuscated);
  the card finder relies on job links/ids, not classes, but titles/companies may come out empty on
  new markup. Checking it on a real account was not done, to keep the account safe.
