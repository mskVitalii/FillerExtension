import type { JobSearchQuery, JobSearchResult } from "@/types/job-search";
import { formatSalaryRange } from "@/lib/salary";
import { dropStalePostings } from "./freshness";
import { applyGradesToTerms } from "./grades";
import { adzunaExcludeWords } from "./negative";

interface AdzunaJob {
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url: string;
  salary_min?: number;
  salary_max?: number;
  description?: string;
  /** ISO timestamp of when Adzuna first saw the posting, e.g. "2013-11-08T18:07:39Z". */
  created?: string;
}

interface AdzunaResponse {
  results: AdzunaJob[];
}

/** Reuses the app's one canonical salary-range display format (`lib/salary.ts`) rather than a second one. */
function formatSalary(min?: number, max?: number): string {
  if (!min && !max) return "";
  return formatSalaryRange({ low: Math.round(min ?? max ?? 0), high: Math.round(max ?? min ?? 0) });
}

export interface AdzunaCredentials {
  appId: string;
  appKey: string;
}

/**
 * spec_5 section C, option 3: Adzuna's own job-search API
 * (https://developer.adzuna.com/docs/search) already returns structured
 * listings — no AI parse pass needed, unlike the other two providers.
 *
 * Adzuna is a literal keyword search, not an LLM — "what" is confirmed
 * (fetched live from their docs) to be a single free-text keyword phrase
 * (their own example: "javascript developer"), matched as a phrase/AND of
 * its words, not a prompt. Its interactive parameter reference
 * (developer.adzuna.com/activedocs) is a JS-rendered Swagger UI this
 * extension can't fetch, so `what_or`/`what_and`/`title_only`/`category`
 * are deliberately NOT used here — I couldn't verify their exact matching
 * semantics (e.g. whether `what_or` OR's whole phrases or individual
 * words), and guessing wrong on a keyword-matching param would make
 * results worse, not better. What *is* confirmed and used: `what`,
 * `what_exclude`, `where`, `results_per_page`, `content-type`. The highest-
 * leverage fix given "keywords decide a lot" is upstream of this file: the
 * caller (`router.ts`) always derives a real, specific title phrase for
 * `what` — via `suggestSearchQuery()` from the candidate's own CV when the
 * user left it blank — rather than ever sending Adzuna an empty keyword.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Gap between request *launches* (see `searchAdzunaJobs`) — keeps the request rate at what the old one-at-a-time loop could reach at best, ~3/s. */
const REQUEST_GAP_MS = 350;
/** Requests in flight at once. Firing every tag at once tripped Adzuna's rate limit (spec_7 item 13); three, staggered, didn't. */
const MAX_CONCURRENT_REQUESTS = 3;
/** One retry for a 429, after this long. */
const RATE_LIMIT_RETRY_MS = 1200;
/** Upper bound on searches per run (search terms × selected grades). */
const MAX_ADZUNA_REQUESTS = 12;

class AdzunaHttpError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function buildAdzunaUrl(
  tag: string,
  query: Pick<JobSearchQuery, "where" | "negative">,
  credentials: AdzunaCredentials,
  countryCode: string,
  page: number,
): string {
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${countryCode}/search/${page}`);
  url.searchParams.set("app_id", credentials.appId);
  url.searchParams.set("app_key", credentials.appKey);
  url.searchParams.set("results_per_page", "15");
  url.searchParams.set("content-type", "application/json");
  if (tag) url.searchParams.set("what", tag);
  if (query.where) url.searchParams.set("where", query.where);
  const exclude = adzunaExcludeWords(query.negative);
  if (exclude) url.searchParams.set("what_exclude", exclude);
  return url.toString();
}

async function searchOneTag(
  tag: string,
  query: JobSearchQuery,
  credentials: AdzunaCredentials,
  countryCode: string,
  page: number,
): Promise<JobSearchResult[]> {
  const res = await fetch(buildAdzunaUrl(tag, query, credentials, countryCode, page));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AdzunaHttpError(`Adzuna search failed (${res.status}): ${body.slice(0, 300)}`, res.status);
  }

  const data = (await res.json()) as AdzunaResponse;
  const jobs = data.results.map((job) => ({
    title: job.title,
    company: job.company?.display_name ?? "",
    location: job.location?.display_name ?? "",
    url: job.redirect_url,
    salary: formatSalary(job.salary_min, job.salary_max),
    snippet: (job.description ?? "").slice(0, 300),
    postedAt: job.created ?? "",
    source: "adzuna" as const,
    tag,
  }));
  return dropStalePostings(jobs);
}

async function searchOneTagWithRetry(...args: Parameters<typeof searchOneTag>): Promise<JobSearchResult[]> {
  try {
    return await searchOneTag(...args);
  } catch (err) {
    if (!(err instanceof AdzunaHttpError) || err.status !== 429) throw err;
    await sleep(RATE_LIMIT_RETRY_MS);
    return searchOneTag(...args);
  }
}

export interface AdzunaSearchOutcome {
  results: JobSearchResult[];
  /** One message per tag whose request failed (spec_7 item 13) — a 429 on one tag no longer aborts the whole search. */
  warnings: string[];
}

/**
 * `query.tags`, when set (see `suggest-search-tags.ts`), is a small set of
 * title synonyms/per-language variants — run as one Adzuna search per tag
 * and merged, rather than gambling on Adzuna's undocumented `what_or`
 * word-vs-phrase OR semantics (see the file-level comment above for why
 * `what_or` itself is avoided). Falls back to the single `query.what` search
 * when no tags were resolved (a user-typed "what", or a provider other than
 * Adzuna's tag flow never ran).
 *
 * Requests run a few at a time (`MAX_CONCURRENT_REQUESTS`), each launched
 * `REQUEST_GAP_MS` after the previous one — not all at once, which routinely
 * tripped Adzuna's rate limit (spec_7 item 13), and not strictly one after
 * another, which made a 12-term search wait out 12 round trips. Each tag is
 * independently try/caught (a 429 gets one retry): a failure just contributes
 * a warning and the rest still come back. `onTagResults` sees each tag's new
 * (not yet seen) results as soon as they arrive, so the panel can show them
 * before the slowest tag is done; the returned list keeps the tags' order.
 */
export async function searchAdzunaJobs(
  query: JobSearchQuery,
  credentials: AdzunaCredentials,
  countryCode: string,
  page = 1,
  onTagResults?: (results: JobSearchResult[]) => void,
): Promise<AdzunaSearchOutcome> {
  const baseTags = query.tags && query.tags.length > 0 ? query.tags : [query.what];
  // Every grade multiplies the request count, so cap the total.
  const gradeCount = Math.max(query.grades?.length ?? 0, 1);
  const maxBase = Math.max(1, Math.floor(MAX_ADZUNA_REQUESTS / gradeCount));
  const tags = applyGradesToTerms(baseTags.slice(0, maxBase), query.grades);

  const warnings: string[] = [];
  if (baseTags.length > maxBase) {
    warnings.push(`Only the first ${maxBase} search terms were used with ${gradeCount} grades selected.`);
  }

  const perTag: JobSearchResult[][] = tags.map(() => []);
  const failures: (string | null)[] = tags.map(() => null);
  const streamed = new Set<string>();
  let next = 0;
  let lastLaunch = 0;

  async function worker(): Promise<void> {
    while (next < tags.length) {
      const i = next++;
      const wait = lastLaunch + REQUEST_GAP_MS - Date.now();
      lastLaunch = Math.max(Date.now(), lastLaunch + REQUEST_GAP_MS);
      if (wait > 0) await sleep(wait);
      try {
        perTag[i] = await searchOneTagWithRetry(tags[i], query, credentials, countryCode, page);
        const fresh = perTag[i].filter((job) => !streamed.has(job.url));
        for (const job of fresh) streamed.add(job.url);
        if (fresh.length > 0) onTagResults?.(fresh);
      } catch (err) {
        failures[i] = `"${tags[i]}" — ${err instanceof Error ? err.message : "search failed"}`;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_REQUESTS, tags.length) }, worker));

  const seen = new Set<string>();
  const merged: JobSearchResult[] = [];
  for (const job of perTag.flat()) {
    if (seen.has(job.url)) continue;
    seen.add(job.url);
    merged.push(job);
  }
  warnings.push(...failures.filter((f): f is string => f !== null));
  return { results: merged, warnings };
}
