import type { JobSearchQuery, JobSearchResult } from "@/types/job-search";
import { formatSalaryRange } from "@/lib/salary";

interface AdzunaJob {
  title: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  redirect_url: string;
  salary_min?: number;
  salary_max?: number;
  description?: string;
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

/** Gap between sequential Adzuna requests (see `searchAdzunaJobs`) — enough to stay clear of their per-second rate limit without noticeably slowing a 2-4 tag search. */
const REQUEST_GAP_MS = 350;

async function searchOneTag(
  tag: string,
  where: string,
  credentials: AdzunaCredentials,
  countryCode: string,
  page: number,
): Promise<JobSearchResult[]> {
  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${countryCode}/search/${page}`);
  url.searchParams.set("app_id", credentials.appId);
  url.searchParams.set("app_key", credentials.appKey);
  url.searchParams.set("results_per_page", "15");
  url.searchParams.set("content-type", "application/json");
  if (tag) url.searchParams.set("what", tag);
  if (where) url.searchParams.set("where", where);

  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Adzuna search failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as AdzunaResponse;
  return data.results.map((job) => ({
    title: job.title,
    company: job.company?.display_name ?? "",
    location: job.location?.display_name ?? "",
    url: job.redirect_url,
    salary: formatSalary(job.salary_min, job.salary_max),
    snippet: (job.description ?? "").slice(0, 300),
    source: "adzuna" as const,
    tag,
  }));
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
 * Requests run **sequentially**, not `Promise.all` — firing every tag at
 * once routinely tripped Adzuna's rate limit (spec_7 item 13). Each tag is
 * independently try/caught: one 429 no longer aborts the whole search, it
 * just contributes a warning and the rest still come back.
 */
export async function searchAdzunaJobs(
  query: JobSearchQuery,
  credentials: AdzunaCredentials,
  countryCode: string,
  page = 1,
): Promise<AdzunaSearchOutcome> {
  const tags = query.tags && query.tags.length > 0 ? query.tags : [query.what];

  const seen = new Set<string>();
  const merged: JobSearchResult[] = [];
  const warnings: string[] = [];

  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    try {
      const jobs = await searchOneTag(tag, query.where, credentials, countryCode, page);
      for (const job of jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url);
        merged.push(job);
      }
    } catch (err) {
      warnings.push(`"${tag}" — ${err instanceof Error ? err.message : "search failed"}`);
    }
    if (i < tags.length - 1) await sleep(REQUEST_GAP_MS);
  }

  return { results: merged, warnings };
}
