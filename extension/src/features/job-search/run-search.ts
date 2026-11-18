import type { JobSearchQuery, JobSearchResult, JobSearchStageTiming } from "@/types/job-search";
import { getPersonalLegend, getProfile } from "@/features/profile/repository";
import { getJobSearchCredentials } from "@/features/storage/local";
import { searchOpenAiJobs } from "./openai-provider";
import { searchTavilyJobs } from "./tavily-provider";
import { searchAdzunaJobs } from "./adzuna-provider";
import { adzunaCountryCode } from "./adzuna-country";
import { timeStage } from "./timing";
import { getSearchSuggestion } from "./suggestion-cache";

export interface JobSearchRun {
  results: JobSearchResult[];
  /** The query as searched — Adzuna fills in `tags` (and `what`/`where`) the next page must reuse. */
  resolvedQuery: JobSearchQuery;
  /** Adzuna only: one message per tag whose request failed — a partial-results notice. */
  warnings?: string[];
  totalMs: number;
  stages: JobSearchStageTiming[];
}

/**
 * One job search with any provider — what the Side Panel's Job Search runs
 * (`SEARCH_JOBS` in `background/router.ts`) and what the local agent runs for
 * its own Search tab, so both find postings the same way.
 */
export async function runJobSearch(
  query: JobSearchQuery,
  options: { page?: number; excludeResults?: JobSearchResult[]; onResults?: (partial: JobSearchResult[]) => void } = {},
): Promise<JobSearchRun> {
  const startedAt = performance.now();
  const stages: JobSearchStageTiming[] = [];
  const timing = () => ({ totalMs: performance.now() - startedAt, stages });

  if (query.provider === "adzuna") {
    // Adzuna's "what" is a keyword search field, not an LLM prompt — the
    // candidate digest below is for the two AI-backed providers only.
    const [creds, profile] = await Promise.all([getJobSearchCredentials(), getProfile()]);
    if (!creds.adzunaAppId || !creds.adzunaAppKey) {
      throw new Error("Add your Adzuna app_id and app_key in Settings first.");
    }
    // "Keywords decide a lot" for a literal keyword search — never send
    // Adzuna a single empty/guessed "what" just because the user left it
    // blank; derive a whole set of title-synonym + per-spoken-language
    // tags from their own CV instead (`suggestSearchTags`), and fan the
    // search out over all of them (`searchAdzunaJobs`). Returned as
    // `resolvedQuery` so the caller locks `tags` (and `what`/`where`) into
    // its own state — otherwise a "load more" page 2 would re-derive
    // independently and could land on a *different* tag set than page 1.
    let resolved = query;
    if (!resolved.tags?.length) {
      if (resolved.what.trim()) {
        // A user-typed keyword is a deliberate, specific override — respect
        // it as-is rather than second-guessing it with AI-derived tags.
        resolved = { ...resolved, tags: [resolved.what.trim()] };
      } else {
        const startedSuggest = performance.now();
        const suggestion = await getSearchSuggestion(true);
        stages.push({ label: suggestion.cached ? "Suggest tags (cached)" : "Suggest tags", ms: performance.now() - startedSuggest });
        resolved = {
          ...resolved,
          what: suggestion.what,
          where: resolved.where.trim() || suggestion.where,
          tags: suggestion.tags?.length ? suggestion.tags : [suggestion.what],
        };
      }
    }
    const { results, warnings } = await timeStage(stages, "Adzuna search", () =>
      searchAdzunaJobs(
        resolved,
        { appId: creds.adzunaAppId, appKey: creds.adzunaAppKey },
        adzunaCountryCode(profile.country),
        options.page ?? 1,
        options.onResults,
      ),
    );
    return { results, resolvedQuery: resolved, warnings, ...timing() };
  }

  // Per spec_8 item 8: job-search grounding uses the applicant's own
  // Personal Legend directly rather than a separately AI-generated
  // digest — one less thing to keep in sync, and the applicant already
  // controls exactly what it says.
  const [legend, creds] = await Promise.all([getPersonalLegend(), getJobSearchCredentials()]);
  const background = legend?.content ?? "";
  if (query.provider === "tavily") {
    if (!creds.tavilyApiKey) throw new Error("Add your Tavily API key in Settings first.");
    const results = await searchTavilyJobs(query, creds.tavilyApiKey, background, options.excludeResults, stages);
    return { results, resolvedQuery: query, ...timing() };
  }
  const results = await searchOpenAiJobs(query, background, options.excludeResults, stages, options.onResults);
  return { results, resolvedQuery: query, ...timing() };
}
