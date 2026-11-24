import type { JobSearchResult, JobSearchSource } from "@/types/job-search";

/** The chip text per source — short, the brand's own name. */
export const SOURCE_LABELS: Record<JobSearchSource, string> = {
  openai: "OpenAI",
  tavily: "Tavily",
  adzuna: "Adzuna",
  jobsuche: "Arbeitsagentur",
  linkedin: "LinkedIn",
};

/** A source id as its chip text; an id this build doesn't know (a newer agent's) shows as itself. */
export function sourceLabel(source: string): string {
  return (SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

/** Every source that found the result, `source` first, without repeats. */
export function resultSources(result: Pick<JobSearchResult, "source" | "sources">): JobSearchSource[] {
  const out: JobSearchSource[] = [];
  for (const s of [result.source, ...(result.sources ?? [])]) if (s && !out.includes(s)) out.push(s);
  return out;
}
