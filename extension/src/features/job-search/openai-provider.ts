import type { JobSearchQuery, JobSearchResult, JobSearchStageTiming } from "@/types/job-search";
import { timeStage } from "./timing";
import { searchRefinements } from "./refinements";
import { streamWithWebSearch } from "@/features/openai/client";
import { extractJobListings } from "@/features/openai/extract-job-listings";
import { describeExcluded } from "./exclude-list";
import { ATS_DOMAINS, MAX_POSTING_AGE_DAYS, dropStalePostings } from "./freshness";
import { createListingLineParser } from "./listing-lines";
import { todayISO } from "@/lib/date-format";

/**
 * Postings per search (each shard asks for up to this many). Output is most of a
 * web search's latency, and "More" fetches the next batch.
 */
export const MAX_OPENAI_RESULTS = 6;

/**
 * One search is split into parallel low-effort web searches, each told where to
 * look. Measured (Nov 2026, gpt-6-luna, a 26 KB Personal Legend): one search at
 * the default effort ran ~10 web searches and took 47-75 s for 3 postings; one at
 * "low" took ~10 s but kept only 1. Three low-effort shards cost about as many
 * tokens as the old single call, finish in about the time of the slowest one, and
 * stream postings from whichever shard is first.
 */
export const OPENAI_SEARCH_SHARDS: readonly { id: string; focus: string }[] = [
  { id: "ats", focus: `Look on applicant tracking systems: ${ATS_DOMAINS.join(", ")}.` },
  { id: "careers", focus: "Look on the hiring companies' own career pages (company websites, not job boards)." },
  {
    id: "boards",
    focus:
      "Look on job boards and aggregators (LinkedIn, Indeed, StepStone, Glassdoor, Welcome to the Jungle, Wellfound, Arbeitnow and similar); when the board links to the employer's own posting, give that URL.",
  },
];

/**
 * spec_5 section C, option 1: OpenAI's own hosted web-search tool finds
 * current postings live and writes them straight out as JSON Lines — one
 * posting object per line — so each one can be shown the moment its line is
 * done, and no second AI call is needed to structure prose. Only when the
 * model ignores the format and answers in prose does `extractJobListings`
 * (the pass Tavily also uses) turn that text into postings after all.
 *
 * `candidateBackground` (the applicant's own Personal Legend, spec_8 item 8)
 * is the main grounding for what to search for — per explicit user
 * direction, a job search should draw on everything known about the
 * candidate, not just a short typed query. `query.what`/`where`/`remoteOnly`
 * layer on top as this particular search's own refinement, so the same rich
 * background can be reused across different searches ("this time, only
 * remote", "this time, a different city") without retyping it.
 */
export function buildOpenAiSearchPrompt(
  query: JobSearchQuery,
  candidateBackground: string,
  excludeResults: JobSearchResult[] = [],
  focus?: string,
): string {
  const refinements = searchRefinements(query);
  const today = todayISO();
  return `Search the web for current, actually open job postings that fit this
candidate:

${candidateBackground || "(no candidate background available)"}

${refinements || "No further constraints — use the candidate's own background to pick a fitting role/location."}

Today is ${today}. Only include postings published in the last ${MAX_POSTING_AGE_DAYS} days
that are still accepting applications — skip anything marked closed, expired or filled,
or shown with an older date. Skip postings that are a poor fit for the candidate (wrong
seniority, unrelated field).
Prefer the employer's own posting on its applicant tracking system (${ATS_DOMAINS.join(", ")})
or career page over copies on aggregators, which often outlive the real posting.
Only real individual postings with their direct listing URL — never a search results page,
a generic careers homepage or an aggregator's category page.${focus ? `\n${focus}` : ""}${describeExcluded(excludeResults)}

OUTPUT FORMAT — follow exactly. Up to ${MAX_OPENAI_RESULTS} of the best matches, best first, as JSON
Lines: one JSON object per line, nothing else (no prose, no markdown, no code fences, no
citations). Each object has exactly these string keys:
{"title":"","company":"","location":"","url":"","salary":"","postedAt":"","snippet":""}
- "url": the posting's direct URL as found.
- "salary": as stated, or "" — never guess.
- "postedAt": YYYY-MM-DD when the posting states a date (resolve "3 days ago" against
  ${today}), else "".
- "snippet": one sentence, at most 25 words, on why it fits this candidate.
If you find no fitting posting, output nothing.`;
}

/**
 * Time budget for one OpenAI web search. Measured (Nov 2026, gpt-6-luna): at the
 * default reasoning effort the model ran ~10 searches and wrote its first posting
 * after 40-70 s; at "low" it runs 1-3 and the first posting arrives after 8-15 s.
 */
export const OPENAI_SEARCH_LIMITS = { timeoutMs: 90_000, idleMs: 40_000, parseTimeoutMs: 30_000 } as const;

export interface OpenAiSearchOutcome {
  results: JobSearchResult[];
  /** Set when the search stopped early (timeout, dropped stream) but some postings were already in. */
  warnings: string[];
}

/** Same posting reached through two shards (two URLs) counts once. */
function postingKey(job: JobSearchResult): string {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return job.company ? `${norm(job.company)}|${norm(job.title)}` : job.url;
}

export async function searchOpenAiJobs(
  query: JobSearchQuery,
  candidateBackground: string,
  excludeResults: JobSearchResult[] = [],
  stages?: JobSearchStageTiming[],
  onResults?: (results: JobSearchResult[]) => void,
  signal?: AbortSignal,
): Promise<OpenAiSearchOutcome> {
  const startedAt = performance.now();
  let firstAt: number | null = null;
  const results: JobSearchResult[] = [];
  const seen = new Set<string>();
  const accept = (job: JobSearchResult): boolean => {
    if (seen.has(job.url) || seen.has(postingKey(job))) return false;
    seen.add(job.url);
    seen.add(postingKey(job));
    results.push(job);
    return true;
  };

  const shards = await Promise.allSettled(
    OPENAI_SEARCH_SHARDS.map(async (shard) => {
      const prompt = buildOpenAiSearchPrompt(query, candidateBackground, excludeResults, shard.focus);
      const parser = createListingLineParser((listing) => {
        const [job] = dropStalePostings([{ ...listing, source: "openai" }]);
        if (!job || !accept(job)) return;
        firstAt ??= performance.now();
        onResults?.([job]);
      });
      const shardStart = performance.now();
      try {
        const text = await streamWithWebSearch(prompt, parser.push, {
          reasoningEffort: "low",
          timeoutMs: OPENAI_SEARCH_LIMITS.timeoutMs,
          idleMs: OPENAI_SEARCH_LIMITS.idleMs,
          signal,
        });
        parser.end();
        return text;
      } finally {
        stages?.push({ label: `Web search (${shard.id})`, ms: performance.now() - shardStart });
      }
    }),
  );
  stages?.push({ label: "Web search", ms: performance.now() - startedAt });
  if (firstAt !== null) stages?.push({ label: "First result", ms: firstAt - startedAt });

  const failures = shards.flatMap((s, i) => (s.status === "rejected" ? [{ id: OPENAI_SEARCH_SHARDS[i].id, err: s.reason as unknown }] : []));
  const message = (err: unknown) => (err instanceof Error ? err.message : "the search failed");
  if (failures.length === shards.length && results.length === 0) throw failures[0].err;
  const warnings = failures.map((f) => `Web search (${f.id}) stopped: ${message(f.err)}`);
  if (results.length > 0) return { results, warnings };

  // No JSON lines anywhere: a model answered in prose despite the format — structure that the old way.
  const prose = shards
    .map((s) => (s.status === "fulfilled" ? s.value : ""))
    .filter((t) => t.trim())
    .join("\n\n---\n\n");
  if (!prose) return { results, warnings };
  const parsed = await timeStage(stages, "Parse results", () =>
    extractJobListings(prose, "openai", candidateBackground, {
      negative: query.negative,
      where: query.where,
      remoteOnly: query.remoteOnly,
      reasoningEffort: "low",
      timeoutMs: OPENAI_SEARCH_LIMITS.parseTimeoutMs,
      signal,
    }),
  );
  return { results: parsed, warnings };
}
