import type { JobSearchResult } from "@/types/job-search";

/**
 * "Load more" (spec_5 section C): the AI-backed providers have no native
 * pagination — a follow-up search re-runs the same live web search, so
 * without this it tends to surface the same top hits again. Shared by
 * `openai-provider.ts` and `tavily-provider.ts` so both ask for genuinely
 * new postings instead of ones already shown.
 */
export function describeExcluded(results: JobSearchResult[]): string {
  if (results.length === 0) return "";
  const list = results.map((r) => `- ${r.title} at ${r.company} (${r.url})`).join("\n");
  return `\n\nAlready found and shown to the applicant — do NOT return any of these again,
find genuinely different postings instead:\n${list}`;
}
