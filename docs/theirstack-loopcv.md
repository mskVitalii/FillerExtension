# TheirStack and LoopCV as search sources

Added 2026-11-24 (`extension/src/features/job-search/theirstack-provider.ts`,
`loopcv-provider.ts`). This file records what was checked, what wasn't, and the decisions taken
without the user (they were asleep and asked for the decisions to be written down).

## Not live-tested

**Neither source has been run against its real API.** There was no key for either, and the brief
said not to sign up or create keys. The code follows the published schemas (below) and is checked by
`extension/test/job-search-theirstack-loopcv.test.ts` against synthetic fixtures in that shape
(`test/fixtures/theirstack/`, `test/fixtures/loopcv/`). What *was* checked live without a key:

- TheirStack: `POST /v1/jobs/search` without a key answers `{"error":{"title":"Not authenticated"}}`;
  a CORS preflight from a `chrome-extension://` origin is answered with that origin reflected, so the
  extension needs no host permission.
- LoopCV: `b2b-api.loopcv.com/connect/*` answers 401 without a key and sends no CORS headers (the
  preflight gets a 401 too), so the extension needs the optional host permission
  `https://b2b-api.loopcv.com/*`. The marketing page's `api.loopcv.pro/v1/jobs?keyword=…` example
  points at a host that doesn't resolve (NXDOMAIN).

The first real run with a key is the test. What to look at then: TheirStack's `final_url` coverage
and whether `easy_apply_or_null: false` + `property_exists_or: ["final_url"]` leave enough results;
LoopCV's `matches` shape (the docs show `applyLink`, `email`, `domain`) and how long a new loop takes
to fill.

## TheirStack

API: `POST https://api.theirstack.com/v1/jobs/search`, `Authorization: Bearer <key>`, OpenAPI at
`https://api.theirstack.com/openapi.json` (read 2026-11-24). **1 API credit per job returned.** Free
plan: 200 API credits a month, ≤ 25 results a page, 10 requests a minute / 50 an hour / 400 a day.
Paid from $19 for 1,500 credits. A `limit` the balance can't cover answers 402 without charging.

Decisions, all aimed at spending as little as possible:

- **One request per search**, all terms in `job_title_or` (≤ 8), `limit` 10, newest first,
  `include_total_results: false`.
- **Only what the agent would apply to:** `posted_at_max_age_days: 14`, `is_closed: false`,
  `property_exists_or: ["final_url"]` (the employer's career page / ATS), `easy_apply_or_null: false`
  (an Easy Apply job only lives on the board, and the agent rejects board-only postings), the
  country (`job_country_code_or`, from the place or the profile), the city as a regex
  (`job_location_pattern_or`, both spellings for München/Munich etc.) unless remote only
  (`workplace_types_or: ["remote"]`), `job_seniority_or` from the grades,
  `company_type: "direct_employer"` when "what I don't want" excludes agencies, the offline negative
  terms as `job_title_not`.
- **No place and not remote → skipped** with a warning, so it never pays for jobs worldwide.
- **Never the same job twice:** every TheirStack id returned is remembered in
  `chrome.storage.local` `theirstackState.seen` (last 2,000) and sent as `job_id_not`, together with
  the ids of results already on screen (`JobSearchResult.sourceIds.theirstack`, which survives the
  cross-source merge).
- **Daily budget of 25 credits** (`DAILY_CREDIT_BUDGET`, UTC day): a search asks for at most what's
  left; once it's used up TheirStack is skipped with a warning. With the free plan's 200 a month
  that's ~8 days of full use; on a paid plan it caps a runaway autopilot.
- **Pages:** the autopilot asks pages 1–3 (`THEIRSTACK_MAX_PAGE`); each "page" is a fresh request
  excluding everything seen, so it never re-buys page 1.
- **Link:** `final_url` is the result's link, the board listing (`url`) its `boardUrl`; a job without
  `final_url` (shouldn't come back with the filter) is marked board-only.

## LoopCV

API: `https://b2b-api.loopcv.com/connect`, header `X-API-KEY`, docs at `https://api-docs.loopcv.com`
(read 2026-11-24). No pagination, rate limits or per-call prices are documented.

LoopCV doesn't search on request: a **loop** is a saved search (title, `"city, country"`, type, level)
that LoopCV runs several times a day; its jobs are read later (`GET /loop/{id}/matches`).

Decisions:

- **One loop per term and place**, at most 2 terms per search, type `Full-time`, level from the
  grades (senior/lead → Senior, middle → Associate, junior/student → Junior, none → Associate).
  The loop id is remembered in `chrome.storage.local` `loopcvLoops`; `externalId` is
  `filler:<title|location|level>` so they're recognisable in the LoopCV account.
- **At most 6 loops:** creating a seventh deletes the least recently used one at LoopCV, so changing
  searches doesn't pile loops up in the user's account.
- **First run says so:** a brand-new loop has no jobs yet; the search shows "LoopCV collects jobs for
  it several times a day" and the postings come with later searches (the autopilot's next cycle).
- **Reads `matches`, not `jobs`:** matches carry `applyLink` (the employer's apply page), which wins
  over `url` (the listing). A job with only a job-board link is marked board-only.
- **One page:** a loop has no pages, so page 2+ returns nothing from LoopCV.
- A term that fails is a warning; LoopCV fails as a whole only when every term failed.

## Both

- **Keys are global** (extension: `chrome.storage.local` with the Tavily/Adzuna keys; FillerAgent:
  `config.search.theirstackApiKey` / `loopcvApiKey`, not per project), pushed from the extension to
  the agent with the other search keys. No key → the source is skipped silently.
- **Side sources:** with a key and the switch on (default on), they run next to whichever provider is
  picked, in the Side Panel's Job Search, FillerAgent's Search tab and every autopilot round, and are
  merged with `mergeSourceResults` (one card per posting, a chip per source). They can also be picked
  as the provider.
- Each result carries `sourceIds` (`theirstack`, `loopcv`, `jobsuche`) so a merged posting still knows
  its id at every source.
- Errors and skips are warnings next to the results, never the search's error.
