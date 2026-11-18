import type { JobSearchQuery, JobSearchResult, JobSearchStageTiming } from "@/types/job-search";
import { timeStage } from "./timing";
import { searchRefinements } from "./refinements";
import { negativeDomains } from "./negative";
import { extractJobListings } from "@/features/openai/extract-job-listings";
import { describeExcluded } from "./exclude-list";
import { ATS_DOMAINS, dropStalePostings } from "./freshness";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  /** Present when `include_published_date` is set and Tavily knows the page's date. */
  published_date?: string;
}

interface TavilyResponse {
  results: TavilyResult[];
}

/**
 * spec_5 section C, option 2: Tavily's search API (https://docs.tavily.com/documentation/api-reference/endpoint/search)
 * returns raw web results, not structured job postings — `extractJobListings`
 * runs the same AI parse pass the OpenAI web-search provider uses, over the
 * concatenated title/url/content of each hit, and (per explicit user
 * direction — job search should draw on everything known about the
 * candidate, and Tavily should be grounded exactly like the OpenAI provider)
 * is handed `candidateBackground` (the applicant's own Personal Legend,
 * spec_8 item 8) for that pass too.
 *
 * Tavily's own `query` is documented with a full-question example ("Who is
 * Leo Messi?"), not a bare keyword string, and no maximum length is stated —
 * so unlike Adzuna's literal keyword search, the full digest goes straight
 * into it here, same as the OpenAI provider's prompt. Capped defensively
 * (`MAX_QUERY_LENGTH`) since that length limit isn't documented either.
 */
const MAX_QUERY_LENGTH = 2000;

/**
 * Tavily has no keyword-exclusion parameter, so the negative prompt rides in
 * the natural-language query (via `searchRefinements`) and in the parse pass;
 * only terms that are domains ("linkedin.com") are dropped natively, through
 * `exclude_domains`.
 */
export function buildTavilyRequest(
  query: JobSearchQuery,
  apiKey: string,
  candidateBackground: string,
  excludeResults: JobSearchResult[] = [],
): Record<string, unknown> {
  const searchQuery = `Find job postings from the last few weeks, still open, that fit this candidate.
${searchRefinements(query)}

Candidate background: ${candidateBackground || "(none available)"}${describeExcluded(excludeResults)}`
    .trim()
    .slice(0, MAX_QUERY_LENGTH);

  const excludeDomains = negativeDomains(query.negative);
  return {
    api_key: apiKey,
    query: searchQuery,
    search_depth: "advanced",
    max_results: 15,
    include_answer: false,
    // Recency cut at the source: pages published or updated in the last
    // month. Anything older is the main cause of dead links.
    time_range: "month",
    include_published_date: true,
    // "prefer", not "restrict": rank the employers' own ATS postings first
    // without losing career pages and boards outside the list.
    include_domains: ATS_DOMAINS,
    include_domains_mode: "prefer",
    ...(excludeDomains.length > 0 ? { exclude_domains: excludeDomains } : {}),
  };
}

/** Tavily's "advanced" search usually answers in 3-8 s; the parse pass in 5-15 s. */
export const TAVILY_LIMITS = { searchTimeoutMs: 25_000, parseTimeoutMs: 40_000 } as const;

export interface TavilySearchOutcome {
  results: JobSearchResult[];
  warnings: string[];
}

async function fetchTavily(body: Record<string, unknown>, signal?: AbortSignal): Promise<TavilyResponse> {
  for (let attempt = 1; ; attempt++) {
    const timeout = AbortSignal.timeout(TAVILY_LIMITS.searchTimeoutMs);
    let res: Response;
    try {
      res = await fetch(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      if (timeout.aborted) throw new Error(`Tavily search timed out after ${TAVILY_LIMITS.searchTimeoutMs / 1000} s.`);
      if (signal?.aborted || attempt >= 2) throw err;
      continue;
    }
    if (res.ok) return (await res.json()) as TavilyResponse;
    const text = await res.text().catch(() => "");
    // One more try on a rate limit or a Tavily-side failure; a bad key or request won't get better.
    if (attempt >= 2 || !(res.status === 429 || res.status >= 500)) {
      throw new Error(`Tavily search failed (${res.status}): ${text.slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
}

/** Raw Tavily hits as postings, for when the parse pass fails: unranked, but the links work. */
function rawTavilyListings(results: TavilyResult[]): JobSearchResult[] {
  return dropStalePostings(
    results.map((r) => ({
      title: r.title,
      company: "",
      location: "",
      url: r.url,
      salary: "",
      snippet: r.content.slice(0, 240),
      postedAt: r.published_date?.slice(0, 10) ?? "",
      source: "tavily" as const,
    })),
  );
}

export async function searchTavilyJobs(
  query: JobSearchQuery,
  apiKey: string,
  candidateBackground: string,
  excludeResults: JobSearchResult[] = [],
  stages?: JobSearchStageTiming[],
  signal?: AbortSignal,
): Promise<TavilySearchOutcome> {
  const body = buildTavilyRequest(query, apiKey, candidateBackground, excludeResults);
  const data = await timeStage(stages, "Tavily search", () => fetchTavily(body, signal));
  if (!data.results?.length) return { results: [], warnings: [] };

  const rawText = data.results
    .map((r) => `Title: ${r.title}\nURL: ${r.url}\n${r.published_date ? `Published: ${r.published_date}\n` : ""}${r.content}`)
    .join("\n\n---\n\n");
  try {
    const results = await timeStage(stages, "Parse results", () =>
      extractJobListings(rawText, "tavily", candidateBackground, {
        negative: query.negative,
        reasoningEffort: "low",
        timeoutMs: TAVILY_LIMITS.parseTimeoutMs,
        signal,
      }),
    );
    return { results, warnings: [] };
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : "parse failed";
    return { results: rawTavilyListings(data.results), warnings: [`Couldn't sort Tavily's results (${reason}) — showing them unfiltered.`] };
  }
}
