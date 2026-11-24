import type { JobSearchQuery, JobSearchResult, JobSearchStageTiming } from "@/types/job-search";
import { getPersonalLegend, getProfile } from "@/features/profile/repository";
import { getJobSearchCredentials, type JobSearchCredentials } from "@/features/storage/local";
import { getPreferences } from "@/features/storage/sync";
import { searchOpenAiJobs } from "./openai-provider";
import { searchTavilyJobs } from "./tavily-provider";
import { searchAdzunaJobs } from "./adzuna-provider";
import { adzunaCountryCode } from "./adzuna-country";
import { hasJobsucheAccess, hasOriginAccess, isGermanSearch, JOBSUCHE_MAX_PAGE, JOBSUCHE_ORIGIN, searchJobsucheJobs } from "./jobsuche-provider";
import { searchTheirStackJobs, THEIRSTACK_MAX_PAGE } from "./theirstack-provider";
import { LOOPCV_ORIGIN, searchLoopCvJobs } from "./loopcv-provider";
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
   * The per-source switches for the sources searched next to `query.provider` (FillerAgent passes
   * its `config.search`; absent: the extension's `Preferences`). The Arbeitsagentur runs only for a
   * place in Germany; TheirStack and LoopCV only with their key.
   */
  jobsuche?: boolean;
  theirstack?: boolean;
  loopcv?: boolean;
}

interface SideContext {
  page: number;
  terms: string[];
  profileCountry: string;
  creds: JobSearchCredentials;
}

/** A source searched next to the chosen provider, merged into its results. */
interface SideSource {
  label: string;
  /** Pages past this one don't ask it again (the autopilot's Tavily cycle has 13 rounds). */
  maxPage: number;
  /** The host permission the extension needs, if any. */
  origin?: string;
  run(query: JobSearchQuery, ctx: SideContext, options: JobSearchOptions): Promise<{ results: JobSearchResult[]; warnings: string[] }>;
}

const SIDE_SOURCES = {
  jobsuche: {
    label: "Arbeitsagentur",
    maxPage: JOBSUCHE_MAX_PAGE,
    origin: JOBSUCHE_ORIGIN,
    run: (query, ctx, options) =>
      searchJobsucheJobs({ ...query, terms: ctx.terms }, ctx.page, { exclude: options.excludeResults, onResults: options.onResults, signal: options.signal }),
  },
  theirstack: {
    label: "TheirStack",
    maxPage: THEIRSTACK_MAX_PAGE,
    run: (query, ctx, options) =>
      searchTheirStackJobs({ ...query, terms: ctx.terms }, ctx.creds.theirstackApiKey, {
        profileCountry: ctx.profileCountry,
        exclude: options.excludeResults,
        signal: options.signal,
      }),
  },
  loopcv: {
    label: "LoopCV",
    maxPage: 1,
    origin: LOOPCV_ORIGIN,
    run: (query, ctx, options) =>
      searchLoopCvJobs({ ...query, terms: ctx.terms }, ctx.creds.loopcvApiKey, {
        page: ctx.page,
        profileCountry: ctx.profileCountry,
        exclude: options.excludeResults,
        signal: options.signal,
      }),
  },
} satisfies Record<string, SideSource>;

const ACCESS_HINT: Record<string, string> = {
  [JOBSUCHE_ORIGIN]: "rest.arbeitsagentur.de",
  [LOOPCV_ORIGIN]: "b2b-api.loopcv.com",
};

/**
 * One job search with any provider — what the Side Panel's Job Search runs
 * (`SEARCH_JOBS` in `background/router.ts`) and what the local agent runs for
 * its own Search tab, so both find postings the same way. The side sources
 * (`SIDE_SOURCES`: the Bundesagentur's job board in Germany, TheirStack and
 * LoopCV with a key) run next to it, merged in with the same posting shown once
 * and tagged with every source that found it.
 */
export async function runJobSearch(query: JobSearchQuery, options: JobSearchOptions = {}): Promise<JobSearchRun> {
  const [prefs, profile, creds] = await Promise.all([
    getPreferences().catch(() => null),
    getProfile().catch(() => null),
    getJobSearchCredentials().catch(() => null),
  ]);
  const profileCountry = profile?.country ?? "";
  const sides: SideSource[] = [];
  if (query.provider !== "jobsuche" && (options.jobsuche ?? prefs?.jobsucheEnabled ?? true) && isGermanSearch(query.where, profileCountry)) {
    sides.push(SIDE_SOURCES.jobsuche);
  }
  if (query.provider !== "theirstack" && creds?.theirstackApiKey && (options.theirstack ?? prefs?.theirstackEnabled ?? true)) sides.push(SIDE_SOURCES.theirstack);
  if (query.provider !== "loopcv" && creds?.loopcvApiKey && (options.loopcv ?? prefs?.loopcvEnabled ?? true)) sides.push(SIDE_SOURCES.loopcv);
  if (sides.length === 0 || !creds) return runProviderSearch(query, options);
  return withSideSources(query, options, sides, { profileCountry, creds });
}

/**
 * The chosen provider and the side sources at once. They search the same terms (typed, or the
 * CV-derived set — cached, so no second AI call). A side source that fails or isn't allowed is a
 * warning, never the search's error.
 */
async function withSideSources(
  query: JobSearchQuery,
  options: JobSearchOptions,
  sides: SideSource[],
  base: { profileCountry: string; creds: JobSearchCredentials },
): Promise<JobSearchRun> {
  const page = options.page ?? 1;
  let termsPromise: Promise<string[]> | null = null;
  const terms = () =>
    (termsPromise ??= (async () => {
      const own = query.tags?.length ? query.tags : searchTerms(query);
      return cleanTerms(own.length > 0 ? own : ((await getSearchSuggestion(true)).tags ?? []));
    })());
  const runSide = async (side: SideSource) => {
    const started = performance.now();
    if (page > side.maxPage) return { side, results: [] as JobSearchResult[], warnings: [] as string[], ms: 0 };
    if (side.origin && !(await hasOriginAccess(side.origin))) {
      return { side, results: [], warnings: [`${side.label} skipped: allow Filler to reach ${ACCESS_HINT[side.origin]} (Settings → Job search).`], ms: 0 };
    }
    try {
      const outcome = await side.run(query, { page, terms: await terms(), ...base }, options);
      return { side, ...outcome, ms: performance.now() - started };
    } catch (err) {
      return { side, results: [], warnings: [`${side.label} — ${err instanceof Error ? err.message : "search failed"}`], ms: performance.now() - started };
    }
  };
  const [main, ...extras] = await Promise.all([runProviderSearch(query, options), ...sides.map(runSide)]);
  const warnings = [...(main.warnings ?? [])];
  for (const extra of extras) {
    if (extra.ms > 0) main.stages.push({ label: `${extra.side.label} search`, ms: extra.ms });
    warnings.push(...extra.warnings);
    // TheirStack/LoopCV answer all at once: hand their batch over like the providers' own.
    if (extra.side !== SIDE_SOURCES.jobsuche && extra.results.length > 0) options.onResults?.(extra.results);
  }
  return {
    ...main,
    results: mergeSourceResults(main.results, ...extras.map((e) => e.results)),
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

  if (query.provider === "theirstack" || query.provider === "loopcv") {
    // Job APIs with the user's own key: keyword searches over the same term set as the others.
    const [creds, profile] = await Promise.all([getJobSearchCredentials(), getProfile().catch(() => null)]);
    const key = query.provider === "theirstack" ? creds.theirstackApiKey : creds.loopcvApiKey;
    const label = query.provider === "theirstack" ? "TheirStack" : "LoopCV";
    if (!key) throw new Error(`Add your ${label} API key in Settings first.`);
    if (query.provider === "loopcv" && !(await hasOriginAccess(LOOPCV_ORIGIN))) throw new Error("Allow Filler to reach b2b-api.loopcv.com first (Settings → Job search).");
    let resolved = query;
    if (searchTerms(resolved).length === 0) {
      const suggestion = await suggestTerms(stages, "Suggest terms");
      resolved = { ...resolved, terms: suggestion.terms, where: resolved.where.trim() || suggestion.where };
    }
    const common = { profileCountry: profile?.country ?? "", exclude: options.excludeResults, signal: options.signal };
    const { results, warnings } = await timeStage(stages, `${label} search`, () =>
      query.provider === "theirstack"
        ? searchTheirStackJobs(resolved, key, common)
        : searchLoopCvJobs(resolved, key, { ...common, page: options.page ?? 1 }),
    );
    if (results.length > 0) options.onResults?.(results);
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
