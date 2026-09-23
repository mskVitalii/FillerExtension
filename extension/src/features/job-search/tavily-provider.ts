import type { JobSearchQuery, JobSearchResult } from "@/types/job-search";
import { extractJobListings } from "@/features/openai/extract-job-listings";
import { describeExcluded } from "./exclude-list";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title: string;
  url: string;
  content: string;
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

export async function searchTavilyJobs(
  query: JobSearchQuery,
  apiKey: string,
  candidateBackground: string,
  excludeResults: JobSearchResult[] = [],
): Promise<JobSearchResult[]> {
  const remote = query.remoteOnly ? " Prefer remote-friendly roles." : "";
  const refinements = [
    query.what ? `Role/keywords focus: "${query.what}".` : "",
    query.where ? `Location: "${query.where}".` : "",
    remote,
  ]
    .filter(Boolean)
    .join(" ");

  const searchQuery = `Find current, open job postings that fit this candidate.
${refinements}

Candidate background: ${candidateBackground || "(none available)"}${describeExcluded(excludeResults)}`
    .trim()
    .slice(0, MAX_QUERY_LENGTH);

  const res = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: searchQuery,
      search_depth: "advanced",
      max_results: 15,
      include_answer: false,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily search failed (${res.status}): ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as TavilyResponse;
  if (data.results.length === 0) return [];

  const rawText = data.results
    .map((r) => `Title: ${r.title}\nURL: ${r.url}\n${r.content}`)
    .join("\n\n---\n\n");
  return extractJobListings(rawText, "tavily", candidateBackground);
}
