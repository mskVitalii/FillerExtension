import type { JobSearchQuery, JobSearchResult, JobSearchStageTiming } from "@/types/job-search";
import { timeStage } from "./timing";
import { gradesRefinement } from "./grades";
import { requestWithWebSearch } from "@/features/openai/client";
import { extractJobListings } from "@/features/openai/extract-job-listings";
import { describeExcluded } from "./exclude-list";
import { ATS_DOMAINS, MAX_POSTING_AGE_DAYS } from "./freshness";
import { todayISO } from "@/lib/date-format";

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
    gradesRefinement(query.grades),
    remote,
  ]
    .filter(Boolean)
    .join(" ");

  const prompt = `Search the web for current, actually open job postings that fit this
candidate:

${candidateBackground || "(no candidate background available)"}

${refinements || "No further constraints — use the candidate's own background to pick a fitting role/location."}

Today is ${todayISO()}. Only include postings published in the last ${MAX_POSTING_AGE_DAYS} days
that are still accepting applications — skip anything marked closed, expired or filled,
or shown with an older date.
Prefer the employer's own posting on its applicant tracking system (${ATS_DOMAINS.join(", ")})
or career page over copies on aggregators, which often outlive the real posting.

Find real postings with their direct listing URL, not a search results page. List up to
15 of the best matches, each with its title, company, location, salary if stated, the date
it was posted when shown, and a short description of why it fits.${describeExcluded(excludeResults)}`;

  const rawText = await timeStage(stages, "Web search", () => requestWithWebSearch(prompt));
  return timeStage(stages, "Parse results", () => extractJobListings(rawText, "openai", candidateBackground));
}
