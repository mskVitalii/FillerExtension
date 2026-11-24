# Bundesagentur für Arbeit — Jobsuche as a search source

Added 2026-11-24 (`extension/src/features/job-search/jobsuche-provider.ts`). This file records what
was verified against the live API and the decisions taken without the user (they were asleep and
asked for the decisions to be written down).

## The API as it answers today (verified live, 2026-11-24)

- Base `https://rest.arbeitsagentur.de/jobboerse/jobsuche-service`, header `X-API-Key: jobboerse-jobsuche`.
- **Search is `/pc/v6/jobs`.** `/pc/v4/jobs` (what the task brief and older docs name) answers
  `403 No match found for request`. `/pc/v4/app/jobs` works too but isn't used.
  Parameters used: `was`, `wo`, `umkreis`, `angebotsart=1` (jobs), `veroeffentlichtseit=30`,
  `arbeitszeit=ho` (remote only), `zeitarbeit=false` + `pav=false` (only when "What I don't want"
  mentions agencies/Zeitarbeit/recruiters), `page`, `size=15`.
  Response: `ergebnisliste[]` with `referenznummer`, `stellenangebotsTitel`, `firma`,
  `stellenlokationen[].adresse`, `veroeffentlichungszeitraum.von`, salary fields
  (`festgehalt`, `gehaltsspanneVon/Bis`), and *sometimes* `externeURL`.
- **Details are `/pc/v4/jobdetails/<base64(refnr)>`** (v3 and v2 answer 403). They carry the
  description (`stellenangebotsBeschreibung`) and, for postings from partner boards or ATSs,
  **`externeURL`** — capital `URL`; the community docs say `externeUrl`. Both spellings are read.
- The posting's own page is `https://www.arbeitsagentur.de/jobsuche/jobdetail/<refnr>`. A `/` in the
  refnr (e.g. `13319-898750/1_5315CS-S`) must be encoded **twice** (`%252F`): a raw slash redirects
  to the search page, `%2F` is a 404. A nonexistent refnr answers 410.
- **CORS:** the API answers `Access-Control-Allow-Origin` only for `https://www.arbeitsagentur.de`.
  A preflight from a `chrome-extension://` origin gets no CORS headers, so the extension needs a
  host permission. FillerAgent's Node side has no CORS.

Sample: 25 München "Softwareentwickler" postings from the last 3 days — 9 had `externeURL`
(yourfirm.de, get-in-it.de, persy.jobs, finest-jobs.com, bewerbung.jobs); the rest live only on
arbeitsagentur.de (the BA's own postings and staffing agencies' feeds). A live Berlin run: 14
postings, 3 with an external link.

## Decisions

1. **Postings that only live on arbeitsagentur.de are kept, tagged `boardOnly`.** Their `url` is
   the BA page; the result list shows an "Only on the job board" chip. FillerAgent's default
   blocked hosts already contain `arbeitsagentur.de`, so the autopilot records them as rejected by
   the rules ("job board") instead of trying to apply — visible, not lost.
2. **The external link wins.** When the details have `externeURL`, it is `url` (the page the agent
   can apply on) and the BA page is kept as `boardUrl`.
3. **Details for every new posting, politely.** The search listing rarely has the link, so each new
   posting costs one details call: at most 3 terms × 15 results per run, 3 at a time with a 300 ms
   gap, only for postings not already shown (matched by BA page, link, or company + title).
   A posting whose details call fails keeps the BA link (tagged board-only).
4. **A side source, not only a provider.** Jobsuche runs next to whichever provider is chosen
   (OpenAI/Tavily/Adzuna) whenever the search's place is in Germany, with the same terms, and its
   results are merged in. It can also be picked as the provider itself (Side Panel and the
   dashboard's Search tab).
5. **Germany detection** (`isGermanSearch`): the place names Germany/Deutschland or a German city
   (the Tavily rounds' cities plus ~45 more), or names no country or known foreign city and the
   profile's country is Germany. Any other country → skipped.
6. **Toggle on by default.** Extension: Settings → Job search providers → "Also search the
   Arbeitsagentur" (`Preferences.jobsucheEnabled`, sync). FillerAgent: `config.search.jobsuche`
   (dashboard Settings → Search). Off skips it everywhere.
7. **Extension permission:** no manifest change. `https://*/*` is already in
   `optional_host_permissions`, so `https://rest.arbeitsagentur.de/*` is requested at runtime —
   when the toggle is turned on in Settings, or on the first Search in Germany (the Search button's
   click, before anything is awaited), or from the "Allow" link the Search tab shows while access is
   missing. Without access the side search is skipped with a warning; picking it as the provider
   errors with what to do.
8. **Paging:** Jobsuche follows the search's page up to page 5 (`JOBSUCHE_MAX_PAGE`). The
   autopilot's Tavily cycle has 13 rounds; rounds 6–13 search only Tavily, and the next cycle starts
   Jobsuche at page 1 again.
9. **No grades for Jobsuche.** German titles rarely carry a grade word, and each grade would multiply
   the requests; the AI fit check judges seniority afterwards.
10. **Source tags everywhere.** `JobSearchResult.source` already existed; a merged result also has
    `sources` (every source that found it). `JobSearchSource` = the providers + `linkedin` (for the
    LinkedIn collector another session adds). Chips: `components/SourceChips.tsx` in the extension;
    the dashboard's Search tab and the autopilot queue in FillerAgent.
11. **Cross-source dedupe** (`merge-sources.ts`): same normalized link (no `www.`, trailing slash,
    tracking parameters such as `utm_*`), a result's BA page equal to another's link, or the same
    company + title (legal forms and "(m/w/d)" dropped). The kept result is the first, unless the
    other has an employer link and the first is board-only.

## Not verified

- The Side Panel permission prompt and the chips were typechecked and unit-tested, not clicked
  through in Chrome.
- The BA's rate limits aren't documented; nothing in testing (≈100 calls) was throttled.
