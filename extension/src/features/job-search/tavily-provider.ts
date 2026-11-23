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
/**
 * Terms searched per round: every term the user (or the CV) gave, up to the agent's own cap. It used to
 * be 6 of 9, and each page ran the same 6 queries again (Tavily has no pages), so the autopilot found
 * 0-5 new postings a round in a market with thousands (2026-11-23).
 */
export const MAX_TAVILY_QUERIES = 12;
/** Parallel Tavily requests; more than a few at once runs into its rate limit. */
const TAVILY_CONCURRENCY = 4;
/** Tavily's maximum per request. */
const RESULTS_PER_QUERY = 20;
/** What all parse passes of one round read together. */
const MAX_PARSE_HITS = 160;
/** Hits per parse pass: small enough that none is cut at the parser's 40k-character input (it used to drop ~40% of the hits). */
const PARSE_CHUNK = 16;
const PARSE_CONCURRENCY = 4;
const MAX_HIT_CONTENT = 1200;
/** A user-typed place can be a sentence; the query keeps room for the term. */
const MAX_WHERE_LENGTH = 100;

/**
 * How one term is searched. Each round ("page") runs other queries than the last, so "load more" and
 * the autopilot's next round reach postings the last one didn't (Tavily itself has no pages):
 *  - `jobs`: "term" jobs Germany — the open web, the employers' ATS ranked first;
 *  - `ats`: "term" Germany on the ATS hosts only — direct postings the agent can apply to;
 *  - `hiring`: term hiring Germany, published this week — the freshest postings;
 *  - `local`: the local market's own wording ("(m/w/d)" in German-speaking countries);
 *  - `city`: "term" jobs Munich — a country's big cities, two per round (`TAVILY_CITIES`), where a
 *    country-wide query only ever reaches the same few pages.
 */
export type TavilyVariant = "jobs" | "ats" | "hiring" | "local" | "city";

/** One query of a round: its kind, and the place it names when that isn't the search's own ("Munich"). */
export interface TavilyQueryPlan {
  variant: TavilyVariant;
  place?: string;
}

/** The big tech-job cities of the countries a search names most, in order of how many postings they have. */
export const TAVILY_CITIES: Record<string, string[]> = {
  germany: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne", "Stuttgart", "Düsseldorf", "Leipzig", "Karlsruhe", "Dresden", "Hanover", "Nuremberg", "Bonn", "Mannheim", "Essen", "Dortmund"],
  austria: ["Vienna", "Graz", "Linz", "Salzburg"],
  switzerland: ["Zurich", "Geneva", "Basel", "Bern", "Lausanne", "Zug"],
  netherlands: ["Amsterdam", "Rotterdam", "Utrecht", "Eindhoven", "The Hague"],
  "united kingdom": ["London", "Manchester", "Edinburgh", "Cambridge", "Bristol", "Oxford"],
  france: ["Paris", "Lyon", "Toulouse", "Nantes"],
  spain: ["Madrid", "Barcelona", "Valencia", "Málaga"],
  poland: ["Warsaw", "Kraków", "Wrocław", "Gdańsk"],
};
const CITIES_PER_ROUND = 2;

/** The cities a country-wide search spreads over; none when it names a city (or nothing) itself. */
export function tavilyCities(where: string): string[] {
  const country = countryNamedIn(where);
  return country ? (TAVILY_CITIES[country] ?? []) : [];
}

/** How many different rounds a search has before they repeat: the two base rounds, then the cities two at a time. */
export function tavilyRounds(where: string): number {
  return 2 + Math.ceil(tavilyCities(where).length / CITIES_PER_ROUND);
}

/** The queries of round `page` (1-based; past the last round they start over). */
export function tavilyPlan(page: number, where = ""): TavilyQueryPlan[] {
  const round = (Math.max(1, page) - 1) % tavilyRounds(where);
  if (round === 0) return [{ variant: "jobs" }, { variant: "ats" }];
  if (round === 1) return [{ variant: "hiring" }, { variant: "local" }];
  const cities = tavilyCities(where);
  const from = (round - 2) * CITIES_PER_ROUND;
  return cities.slice(from, from + CITIES_PER_ROUND).map((place) => ({ variant: "city" as const, place }));
}

/** The kinds of query of round `page`, for a search without cities. */
export function tavilyVariants(page: number): TavilyVariant[] {
  return tavilyPlan(page).map((p) => p.variant);
}

/** Countries Tavily's `country` boost knows, by the names a "where" uses for them. */
const TAVILY_COUNTRIES: Record<string, string> = {
  germany: "germany", deutschland: "germany", "германия": "germany",
  austria: "austria", "österreich": "austria", switzerland: "switzerland", schweiz: "switzerland",
  netherlands: "netherlands", "the netherlands": "netherlands", france: "france", spain: "spain", italy: "italy",
  poland: "poland", portugal: "portugal", ireland: "ireland", belgium: "belgium", sweden: "sweden", denmark: "denmark",
  finland: "finland", norway: "norway", "czech republic": "czech republic", czechia: "czech republic",
  "united kingdom": "united kingdom", uk: "united kingdom", england: "united kingdom",
  "united states": "united states", usa: "united states", canada: "canada", japan: "japan", singapore: "singapore",
  "united arab emirates": "united arab emirates", uae: "united arab emirates", australia: "australia",
};
const GERMAN_SPEAKING = /(?<!\p{L})(?:germany|deutschland|austria|österreich|switzerland|schweiz|berlin|münchen|munich|hamburg|köln|cologne|frankfurt|stuttgart|düsseldorf|leipzig|dresden|hannover|nürnberg|wien|vienna|zürich|zurich)(?!\p{L})|германи/iu;

/** The country a "where" names by name ("Germany", "UK"), not by one of its cities, or "". */
function countryNamedIn(where: string): string {
  const text = where.toLowerCase();
  for (const [name, country] of Object.entries(TAVILY_COUNTRIES)) {
    if (new RegExp(`(?<![\\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}])`, "u").test(text)) return country;
  }
  return "";
}

/** The country a "where" names, as Tavily's `country` parameter wants it ("germany"), or "". */
export function tavilyCountry(where: string): string {
  const named = countryNamedIn(where);
  if (named) return named;
  // A German city alone ("Berlin") is Germany.
  return GERMAN_SPEAKING.test(where) && !/austria|österreich|wien|vienna|switzerland|schweiz|zürich|zurich/i.test(where) ? "germany" : "";
}

/** One term as a keyword query: `"go developer" jobs Berlin remote senior`, never over `MAX_TAVILY_QUERY_LENGTH`. */
export function buildTavilyQuery(term: string, query: Pick<JobSearchQuery, "where" | "remoteOnly" | "grades">, variant: TavilyVariant = "jobs"): string {
  const phrase = term.replace(/["\s]+/g, " ").trim();
  const grades = JOB_GRADES.filter((g) => query.grades?.includes(g.id))
    .map((g) => g.label.toLowerCase())
    .filter((g) => !phrase.toLowerCase().includes(g));
  const where = query.where.trim().slice(0, MAX_WHERE_LENGTH);
  const word = { jobs: "jobs", city: "jobs", ats: "", hiring: "hiring", local: GERMAN_SPEAKING.test(where) ? "(m/w/d)" : "job opening" }[variant];
  const tail = [word, where, query.remoteOnly ? "remote" : "", ...grades].filter(Boolean).join(" ");
  // The term gets whatever room the rest leaves; the final cut is a guarantee, not the plan.
  const room = Math.max(1, MAX_TAVILY_QUERY_LENGTH - tail.length - 3);
  const quoted = variant === "hiring" ? phrase.slice(0, room).trim() : `"${phrase.slice(0, room).trim()}"`;
  return `${quoted} ${tail}`.slice(0, MAX_TAVILY_QUERY_LENGTH).trim();
}

/**
 * Tavily has no keyword-exclusion parameter, so the negative prompt is applied
 * in the parse pass; only terms that are domains ("linkedin.com") are dropped
 * natively, through `exclude_domains`.
 */
export function buildTavilyRequest(query: JobSearchQuery, term: string, apiKey: string, variant: TavilyVariant = "jobs", place?: string): Record<string, unknown> {
  const excludeDomains = negativeDomains(query.negative);
  const country = tavilyCountry(query.where);
  return {
    api_key: apiKey,
    // A city round names the city in place of the country ("Munich"); the country stays the boost.
    query: buildTavilyQuery(term, place ? { ...query, where: place } : query, variant),
    // "advanced" (2 credits) for the broad query, where its better snippets matter most; "basic" for the rest.
    search_depth: variant === "jobs" ? "advanced" : "basic",
    max_results: RESULTS_PER_QUERY,
    include_answer: false,
    // Recency cut at the source: pages published or updated in the last month (this week for
    // "hiring"). Anything older is the main cause of dead links.
    time_range: variant === "hiring" ? "week" : "month",
    include_published_date: true,
    // "ats": the employers' ATS only (direct postings). Otherwise "prefer": ranked first, without
    // losing career pages and boards outside the list.
    include_domains: ATS_DOMAINS,
    ...(variant === "ats" ? {} : { include_domains_mode: "prefer" }),
    // Ranks pages from the searched country first ("germany").
    ...(country ? { country } : {}),
    ...(excludeDomains.length > 0 ? { exclude_domains: excludeDomains } : {}),
  };
}

/** Tavily's "advanced" search usually answers in 3-8 s; a parse pass in 5-15 s. */
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
 * Two Tavily searches per term (`tavilyPlan(page)`: base, fresh/local, then two cities a round; the caller resolves a CV-derived set when the
 * user gave none), a few at a time, then parse passes over the merged hits in chunks, all told where
 * the search is. A query that fails is a warning; every query failing is an error, not "no postings".
 */
export async function searchTavilyJobs(
  query: JobSearchQuery,
  apiKey: string,
  candidateBackground: string,
  excludeResults: JobSearchResult[] = [],
  stages?: JobSearchStageTiming[],
  signal?: AbortSignal,
  page = 1,
): Promise<TavilySearchOutcome> {
  const all = searchTerms(query);
  if (all.length === 0) throw new Error("Tavily needs at least one search term.");
  const terms = all.slice(0, MAX_TAVILY_QUERIES);
  const warnings: string[] = [];
  if (all.length > terms.length) warnings.push(`Only the first ${terms.length} of ${all.length} search terms were searched with Tavily.`);
  const plan = tavilyPlan(page, query.where);
  const jobs = terms.flatMap((term) => plan.map(({ variant, place }) => ({ term, variant, place })));

  const outcomes = await timeStage(stages, "Tavily search", () =>
    mapLimit(jobs, TAVILY_CONCURRENCY, async ({ term, variant, place }) => {
      try {
        const data = await fetchTavily(buildTavilyRequest(query, term, apiKey, variant, place), signal);
        return { term, variant, hits: data.results ?? [] };
      } catch (err) {
        if (signal?.aborted) throw err;
        return { term, variant, hits: [] as TavilyResult[], error: err };
      }
    }),
  );
  const failed = outcomes.filter((o) => o.error !== undefined);
  if (failed.length === outcomes.length) throw failed[0].error;
  // One warning per term, not per query: a term that failed in both of its queries.
  const failedTerms = [...new Set(failed.map((o) => o.term))].filter((t) => failed.filter((o) => o.term === t).length === plan.length);
  for (const term of failedTerms) {
    const o = failed.find((x) => x.term === term)!;
    warnings.push(`"${term}" — ${o.error instanceof Error ? o.error.message : "search failed"}`);
  }

  const hits = mergeTavilyHits(outcomes.map((o) => o.hits), excludeResults);
  if (hits.length === 0) return { results: [], warnings };

  const chunks: TavilyResult[][] = [];
  for (let i = 0; i < hits.length; i += PARSE_CHUNK) chunks.push(hits.slice(i, i + PARSE_CHUNK));
  const text = (chunk: TavilyResult[]) =>
    chunk.map((r) => `Title: ${r.title}\nURL: ${r.url}\n${r.published_date ? `Published: ${r.published_date}\n` : ""}${(r.content ?? "").slice(0, MAX_HIT_CONTENT)}`).join("\n\n---\n\n");
  const parsed = await timeStage(stages, "Parse results", () =>
    mapLimit(chunks, PARSE_CONCURRENCY, async (chunk) => {
      try {
        return {
          results: await extractJobListings(text(chunk), "tavily", candidateBackground, {
            negative: query.negative,
            where: query.where,
            remoteOnly: query.remoteOnly,
            reasoningEffort: "low",
            timeoutMs: TAVILY_LIMITS.parseTimeoutMs,
            signal,
          }),
        };
      } catch (err) {
        if (signal?.aborted) throw err;
        return { results: rawTavilyListings(chunk), error: err };
      }
    }),
  );
  const seen = new Set<string>();
  const results = parsed.flatMap((p) => p.results).filter((r) => {
    const key = urlKey(r.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const parseFailed = parsed.filter((p) => p.error !== undefined);
  if (parseFailed.length) {
    const reason = parseFailed[0].error instanceof Error ? parseFailed[0].error.message : "parse failed";
    warnings.push(`Couldn't sort ${parseFailed.length === parsed.length ? "Tavily's results" : `${parseFailed.length} of ${parsed.length} batches of Tavily's results`} (${reason}) — showing those unfiltered.`);
  }
  return { results, warnings };
}
