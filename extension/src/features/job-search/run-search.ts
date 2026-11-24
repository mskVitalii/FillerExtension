import type { JobSearchQuery, JobSearchResult, JobSearchStageTiming } from "@/types/job-search";
import { getPersonalLegend, getProfile } from "@/features/profile/repository";
import { getJobSearchCredentials } from "@/features/storage/local";
import { getPreferences } from "@/features/storage/sync";
import { searchOpenAiJobs } from "./openai-provider";
import { searchTavilyJobs } from "./tavily-provider";
import { searchAdzunaJobs } from "./adzuna-provider";
import { adzunaCountryCode } from "./adzuna-country";
import { hasJobsucheAccess, isGermanSearch, JOBSUCHE_MAX_PAGE, searchJobsucheJobs } from "./jobsuche-provider";
import { mergeSourceResults } from "./merge-sources";
import { timeStage } from "./timing";
import { getSearchSuggestion } from "./suggestion-cache";
import { cleanTerms, searchTerms } from "./terms";

export interface JobSearchRun {
  results: JobSearchResult[];
  /** The query as searched — Adzuna fills in `tags` (and `what`/`where`), Tavily `terms`, which the next page must reuse. */
  resolvedQuery: JobSearchQuery;
  /** Partial-results notices: an Adzuna tag that failed, a web search that stopped early, an unsorted Tavily list. */
  warnings?: string[];
  totalMs: number;
  stages: JobSearchStageTiming[];
}

/** The CV-derived term set (title synonyms + per-language variants), timed as one stage. */
async function suggestTerms(stages: JobSearchStageTiming[], label: string): Promise<{ what: string; where: string; terms: string[] }> {
  const started = performance.now();
  const suggestion = await getSearchSuggestion(true);
  stages.push({ label: suggestion.cached ? `${label} (cached)` : label, ms: performance.now() - started });
  const terms = cleanTerms(suggestion.tags?.length ? suggestion.tags : [suggestion.what]);
  if (terms.length === 0) throw new Error("Couldn't derive search terms from your CV — type a few search terms.");
  return { what: suggestion.what, where: suggestion.where, terms };
}

export interface JobSearchOptions {
  page?: number;
  excludeResults?: JobSearchResult[];
  onResults?: (partial: JobSearchResult[]) => void;
  signal?: AbortSignal;
  /**
   * Also search the Bundesagentur's Jobsuche next to `query.provider` when the place is in Germany
   * (the caller's per-source toggle: FillerAgent's `config.search.jobsuche`). Absent: the extension's
   * `Preferences.jobsucheEnabled`.
   */
  jobsuche?: boolean;
}

const NO_JOBSUCHE_ACCESS = "Arbeitsagentur skipped: allow Filler to reach rest.arbeitsagentur.de (Settings → Job search).";

/**
 * One job search with any provider — what the Side Panel's Job Search runs
 * (`SEARCH_JOBS` in `background/router.ts`) and what the local agent runs for
 * its own Search tab, so both find postings the same way. A search in Germany
 * also asks the Bundesagentur's job board (`withJobsuche`), merged in with the
 * same posting shown once and tagged with every source that found it.
 */
export async function runJobSearch(query: JobSearchQuery, options: JobSearchOptions = {}): Promise<JobSearchRun> {
  const enabled = query.provider !== "jobsuche" && (options.jobsuche ?? (await getPreferences().catch(() => null))?.jobsucheEnabled ?? true);
  if (!enabled) return runProviderSearch(query, options);
  const profile = await getProfile().catch(() => null);
  if (!isGermanSearch(query.where, profile?.country ?? "")) return runProviderSearch(query, options);
  return withJobsuche(query, options);
}

/**
 * The chosen provider and the Jobsuche side by side. Jobsuche searches the same terms (typed, or the
 * CV-derived set — cached, so no second AI call) and pages along up to `JOBSUCHE_MAX_PAGE` (the
 * autopilot's Tavily rounds go further; past that page only the provider searches). A Jobsuche that
 * fails or isn't allowed is a warning, never the search's error.
 */
async function withJobsuche(query: JobSearchQuery, options: JobSearchOptions): Promise<JobSearchRun> {
  const page = options.page ?? 1;
  const extra = (async (): Promise<{ results: JobSearchResult[]; warnings: string[]; ms: number }> => {
    const started = performance.now();
    if (page > JOBSUCHE_MAX_PAGE) return { results: [], warnings: [], ms: 0 };
    if (!(await hasJobsucheAccess())) return { results: [], warnings: [NO_JOBSUCHE_ACCESS], ms: 0 };
    try {
      let terms = query.tags?.length ? query.tags : searchTerms(query);
      if (terms.length === 0) terms = (await getSearchSuggestion(true)).tags ?? [];
      const outcome = await searchJobsucheJobs({ ...query, terms: cleanTerms(terms) }, page, {
        exclude: options.excludeResults,
        onResults: options.onResults,
        signal: options.signal,
      });
      return { ...outcome, ms: performance.now() - started };
    } catch (err) {
      return { results: [], warnings: [`Arbeitsagentur — ${err instanceof Error ? err.message : "search failed"}`], ms: performance.now() - started };
    }
  })();
  const [main, ba] = await Promise.all([runProviderSearch(query, options), extra]);
  if (ba.ms > 0) main.stages.push({ label: "Arbeitsagentur search", ms: ba.ms });
  const warnings = [...(main.warnings ?? []), ...ba.warnings];
  return {
    ...main,
    results: mergeSourceResults(main.results, ba.results),
    ...(warnings.length ? { warnings } : {}),
  };
}

async function runProviderSearch(query: JobSearchQuery, options: JobSearchOptions): Promise<JobSearchRun> {
  const startedAt = performance.now();
  const stages: JobSearchStageTiming[] = [];
  const timing = () => ({ totalMs: performance.now() - startedAt, stages });

  if (query.provider === "jobsuche") {
    // The BA's own job board: Germany only, a literal keyword search like Adzuna, no key.
    const profile = await getProfile().catch(() => null);
    let resolved = query;
    if (searchTerms(resolved).length === 0) {
      const suggestion = await suggestTerms(stages, "Suggest terms");
      resolved = { ...resolved, terms: suggestion.terms, where: resolved.where.trim() || suggestion.where };
    }
    if (!isGermanSearch(resolved.where, profile?.country ?? "")) {
      throw new Error("The Arbeitsagentur only lists jobs in Germany — set the location to Germany or a German city.");
    }
    if (!(await hasJobsucheAccess())) throw new Error("Allow Filler to reach rest.arbeitsagentur.de first (Settings → Job search).");
    const { results, warnings } = await timeStage(stages, "Arbeitsagentur search", () =>
      searchJobsucheJobs(resolved, options.page ?? 1, { exclude: options.excludeResults, onResults: options.onResults, signal: options.signal }),
    );
    return { results, resolvedQuery: resolved, ...(warnings.length ? { warnings } : {}), ...timing() };
  }

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
      const terms = searchTerms(resolved);
      if (terms.length > 0) {
        // User-given terms are a deliberate, specific override — respect
        // them as-is rather than second-guessing them with AI-derived tags.
        resolved = { ...resolved, tags: terms };
      } else {
        const suggestion = await suggestTerms(stages, "Suggest tags");
        resolved = {
          ...resolved,
          what: suggestion.what,
          where: resolved.where.trim() || suggestion.where,
          tags: suggestion.terms,
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
        options.signal,
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
    // Tavily is a keyword search like Adzuna: without terms it searches the CV-derived set, locked
    // into `resolvedQuery.terms` so "load more" reuses it.
    let resolved = query;
    if (searchTerms(resolved).length === 0) {
      const suggestion = await suggestTerms(stages, "Suggest terms");
      resolved = { ...resolved, terms: suggestion.terms, where: resolved.where.trim() || suggestion.where };
    }
    const { results, warnings } = await searchTavilyJobs(resolved, creds.tavilyApiKey, background, options.excludeResults, stages, options.signal, options.page ?? 1);
    // Tavily answers all at once: hand the batch over the same way, so callers need one path.
    if (results.length > 0) options.onResults?.(results);
    return { results, resolvedQuery: resolved, ...(warnings.length ? { warnings } : {}), ...timing() };
  }
  const { results, warnings } = await searchOpenAiJobs(query, background, options.excludeResults, stages, options.onResults, options.signal);
  return { results, resolvedQuery: query, ...(warnings.length ? { warnings } : {}), ...timing() };
}
