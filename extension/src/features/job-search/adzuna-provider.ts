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
async function searchOneTag(
  what: string,
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
  if (what) url.searchParams.set("what", what);
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
  }));
}

/**
 * `query.tags`, when set (see `suggest-search-tags.ts`), is a small set of
 * title synonyms/per-language variants — run as one Adzuna search per tag
 * and merged, rather than gambling on Adzuna's undocumented `what_or`
 * word-vs-phrase OR semantics (see the file-level comment above for why
 * `what_or` itself is avoided). Falls back to the single `query.what` search
 * when no tags were resolved (a user-typed "what", or a provider other than
 * Adzuna's tag flow never ran).
 */
export async function searchAdzunaJobs(
  query: JobSearchQuery,
  credentials: AdzunaCredentials,
  countryCode: string,
  page = 1,
): Promise<JobSearchResult[]> {
  const tags = query.tags && query.tags.length > 0 ? query.tags : [query.what];
  const perTag = await Promise.all(tags.map((tag) => searchOneTag(tag, query.where, credentials, countryCode, page)));

  const seen = new Set<string>();
  const merged: JobSearchResult[] = [];
  for (const job of perTag.flat()) {
    if (seen.has(job.url)) continue;
    seen.add(job.url);
    merged.push(job);
  }
  return merged;
}
