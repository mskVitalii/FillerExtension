import { JOB_GRADES, type JobSearchQuery, type JobSearchResult, type JobSearchStageTiming } from "@/types/job-search";
import { timeStage } from "./timing";
import { negativeDomains } from "./negative";
import { searchTerms } from "./terms";
import { extractJobListings } from "@/features/openai/extract-job-listings";
import { ATS_DOMAINS, dropStalePostings } from "./freshness";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

export interface TavilyResult {
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
 * merged title/url/content of the hits, and is handed `candidateBackground`
 * (the applicant's own Personal Legend, spec_8 item 8) for that pass.
 *
 * Tavily itself is a web search engine: its `query` is matched against pages,
 * it rejects anything over 1500 characters ("Query is too long"), and its docs
 * recommend keeping it under 400. The background, the exclusion prompt and the
 * already-shown list used to ride in the query and overflowed it; now each
 * search term gets its own short keyword query, and everything about the
 * candidate stays in the parse pass, where it decides what fits.
 */
export const MAX_TAVILY_QUERY_LENGTH = 350;
/** Each term is one "advanced" Tavily search (2 API credits): a CV-derived set of ten near-synonyms would cost 20 per search. */
export const MAX_TAVILY_QUERIES = 6;
/** Parallel Tavily requests; more than a few at once runs into its rate limit. */
const TAVILY_CONCURRENCY = 3;
const RESULTS_PER_QUERY = 10;
/** What one parse pass reads: enough hits from every term, without a prompt so long the parse times out. */
const MAX_PARSE_HITS = 40;
const MAX_HIT_CONTENT = 1500;
/** A user-typed place can be a sentence; the query keeps room for the term. */
const MAX_WHERE_LENGTH = 100;

/** One term as a keyword query: `"go developer" jobs Berlin remote senior`, never over `MAX_TAVILY_QUERY_LENGTH`. */
export function buildTavilyQuery(term: string, query: Pick<JobSearchQuery, "where" | "remoteOnly" | "grades">): string {
  const phrase = term.replace(/["\s]+/g, " ").trim();
  const grades = JOB_GRADES.filter((g) => query.grades?.includes(g.id))
    .map((g) => g.label.toLowerCase())
    .filter((g) => !phrase.toLowerCase().includes(g));
  const tail = ["jobs", query.where.trim().slice(0, MAX_WHERE_LENGTH), query.remoteOnly ? "remote" : "", ...grades].filter(Boolean).join(" ");
  // The term gets whatever room the rest leaves; the final cut is a guarantee, not the plan.
  const room = Math.max(1, MAX_TAVILY_QUERY_LENGTH - tail.length - 3);
  return `"${phrase.slice(0, room).trim()}" ${tail}`.slice(0, MAX_TAVILY_QUERY_LENGTH).trim();
}

/**
 * Tavily has no keyword-exclusion parameter, so the negative prompt is applied
 * in the parse pass; only terms that are domains ("linkedin.com") are dropped
 * natively, through `exclude_domains`.
 */
export function buildTavilyRequest(query: JobSearchQuery, term: string, apiKey: string): Record<string, unknown> {
  const excludeDomains = negativeDomains(query.negative);
  return {
    api_key: apiKey,
    query: buildTavilyQuery(term, query),
    search_depth: "advanced",
    max_results: RESULTS_PER_QUERY,
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

/** Tavily dates pages RFC 1123-style ("Wed, 28 Oct 2026 10:00:00 GMT"): the first 10 characters of that are no date, so read it whole. */
function isoDay(date: string | undefined): string {
  const time = date ? Date.parse(date) : NaN;
  return Number.isNaN(time) ? "" : new Date(time).toISOString().slice(0, 10);
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
      snippet: (r.content ?? "").slice(0, 240),
      postedAt: isoDay(r.published_date),
      source: "tavily" as const,
    })),
  );
}

/** `items` through `fn`, at most `limit` at a time, results in input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function urlKey(url: string): string {
  return url.trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
}

/**
 * Every term's hits, interleaved (the first hit of each term, then the second…) so the parse cap
 * doesn't keep only the first terms, without repeats and without postings already shown — Tavily
 * has no pages, so "load more" runs the same queries and relies on this to bring only new ones.
 */
export function mergeTavilyHits(perTerm: TavilyResult[][], exclude: JobSearchResult[] = [], max = MAX_PARSE_HITS): TavilyResult[] {
  const seen = new Set(exclude.map((r) => urlKey(r.url)));
  const merged: TavilyResult[] = [];
  const longest = Math.max(0, ...perTerm.map((hits) => hits.length));
  for (let i = 0; i < longest && merged.length < max; i++) {
    for (const hits of perTerm) {
      const hit = hits[i];
      if (!hit?.url || seen.has(urlKey(hit.url))) continue;
      seen.add(urlKey(hit.url));
      merged.push(hit);
      if (merged.length >= max) break;
    }
  }
  return merged;
}

/**
 * One Tavily search per term (`searchTerms`; the caller resolves a CV-derived set when the user gave
 * none), a few at a time, then one parse pass over the merged hits. A term that fails is a warning;
 * every term failing is an error, not "no postings".
 */
export async function searchTavilyJobs(
  query: JobSearchQuery,
  apiKey: string,
  candidateBackground: string,
  excludeResults: JobSearchResult[] = [],
  stages?: JobSearchStageTiming[],
  signal?: AbortSignal,
): Promise<TavilySearchOutcome> {
  const all = searchTerms(query);
  if (all.length === 0) throw new Error("Tavily needs at least one search term.");
  const terms = all.slice(0, MAX_TAVILY_QUERIES);
  const warnings: string[] = [];
  if (all.length > terms.length) warnings.push(`Only the first ${terms.length} of ${all.length} search terms were searched with Tavily.`);

  const outcomes = await timeStage(stages, "Tavily search", () =>
    mapLimit(terms, TAVILY_CONCURRENCY, async (term) => {
      try {
        const data = await fetchTavily(buildTavilyRequest(query, term, apiKey), signal);
        return { term, hits: data.results ?? [] };
      } catch (err) {
        if (signal?.aborted) throw err;
        return { term, hits: [] as TavilyResult[], error: err };
      }
    }),
  );
  const failed = outcomes.filter((o) => o.error !== undefined);
  if (failed.length === outcomes.length) throw failed[0].error;
  for (const o of failed) warnings.push(`"${o.term}" — ${o.error instanceof Error ? o.error.message : "search failed"}`);

  const hits = mergeTavilyHits(outcomes.map((o) => o.hits), excludeResults);
  if (hits.length === 0) return { results: [], warnings };

  const rawText = hits
    .map((r) => `Title: ${r.title}\nURL: ${r.url}\n${r.published_date ? `Published: ${r.published_date}\n` : ""}${(r.content ?? "").slice(0, MAX_HIT_CONTENT)}`)
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
    return { results, warnings };
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : "parse failed";
    return { results: rawTavilyListings(hits), warnings: [...warnings, `Couldn't sort Tavily's results (${reason}) — showing them unfiltered.`] };
  }
}
