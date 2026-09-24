import type { JobSearchQuery, JobSearchResult, JobSearchStageTiming } from "@/types/job-search";
import { timeStage } from "./timing";
import { requestWithWebSearch } from "@/features/openai/client";
import { extractJobListings } from "@/features/openai/extract-job-listings";
import { describeExcluded } from "./exclude-list";

/**
 * spec_5 section C, option 1: OpenAI's own hosted web-search tool finds
 * current postings live, then `extractJobListings` turns that raw text into
 * the app's normalized shape (spec_5 section C's other two providers share
 * that same second pass).
 *
 * `candidateBackground` (the applicant's own Personal Legend, spec_8 item 8)
 * is the main grounding for what to search for — per explicit user
 * direction, a job search should draw on everything known about the
 * candidate, not just a short typed query. `query.what`/`where`/`remoteOnly`
 * layer on top as this particular search's own refinement, so the same rich
 * background can be reused across different searches ("this time, only
 * remote", "this time, a different city") without retyping it.
 */
export async function searchOpenAiJobs(
  query: JobSearchQuery,
  candidateBackground: string,
  excludeResults: JobSearchResult[] = [],
  stages?: JobSearchStageTiming[],
): Promise<JobSearchResult[]> {
  const remote = query.remoteOnly ? " Prefer remote-friendly roles." : "";
  const refinements = [
    query.what ? `Role/keywords focus: "${query.what}".` : "",
    query.where ? `Location: "${query.where}".` : "",
    remote,
  ]
    .filter(Boolean)
    .join(" ");

  const prompt = `Search the web for current, actually open job postings that fit this
candidate:

${candidateBackground || "(no candidate background available)"}

${refinements || "No further constraints — use the candidate's own background to pick a fitting role/location."}

Find real postings (company career pages, LinkedIn, job boards) with their direct
listing URL, not a search results page. List up to 15 of the best matches, each with
its title, company, location, salary if stated, and a short description of why it fits.${describeExcluded(excludeResults)}`;

  const rawText = await timeStage(stages, "Web search", () => requestWithWebSearch(prompt));
  return timeStage(stages, "Parse results", () => extractJobListings(rawText, "openai", candidateBackground));
}
