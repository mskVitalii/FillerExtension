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
 * Postings per search. Output is most of a web search's latency, and "More"
 * fetches the next batch, so 10 good ones beat 15 slower ones.
 */
export const MAX_OPENAI_RESULTS = 10;

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
a generic careers homepage or an aggregator's category page.${describeExcluded(excludeResults)}

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

export async function searchOpenAiJobs(
  query: JobSearchQuery,
  candidateBackground: string,
  excludeResults: JobSearchResult[] = [],
  stages?: JobSearchStageTiming[],
  onResults?: (results: JobSearchResult[]) => void,
): Promise<JobSearchResult[]> {
  const prompt = buildOpenAiSearchPrompt(query, candidateBackground, excludeResults);
  const startedAt = performance.now();
  let firstAt: number | null = null;
  const results: JobSearchResult[] = [];
  const seen = new Set<string>();
  const parser = createListingLineParser((listing) => {
    const [job] = dropStalePostings([{ ...listing, source: "openai" }]);
    if (!job || seen.has(job.url)) return;
    seen.add(job.url);
    results.push(job);
    firstAt ??= performance.now();
    onResults?.([job]);
  });

  const rawText = await timeStage(stages, "Web search", () => streamWithWebSearch(prompt, parser.push));
  parser.end();
  if (firstAt !== null) stages?.push({ label: "First result", ms: firstAt - startedAt });
  if (results.length > 0 || !rawText.trim()) return results;

  // The model answered in prose despite the format — structure it the old way.
  return timeStage(stages, "Parse results", () =>
    extractJobListings(rawText, "openai", candidateBackground, { negative: query.negative, reasoningEffort: "low" }),
  );
}
