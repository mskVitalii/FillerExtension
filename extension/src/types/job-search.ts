/** spec_5 section C: one normalized result across all three search providers. */
export interface JobSearchResult {
  title: string;
  company: string;
  location: string;
  url: string;
  /** Free text — a range, a single figure, or "" when the source gave none. */
  salary: string;
  snippet: string;
  /** When the posting was published (ISO date or timestamp), or "" / absent when the source didn't say. */
  postedAt?: string;
  source: "openai" | "tavily" | "adzuna";
  /** Adzuna only: the search tag/category this result came from (spec_7 item 13) — lets the UI group results by category. */
  tag?: string;
}

export type JobSearchProvider = "openai" | "tavily" | "adzuna";

/** Seniority levels a search can target; several can be selected at once. `keyword` is what Adzuna's literal keyword search gets prefixed with. */
export const JOB_GRADES = [
  { id: "student", label: "Student", keyword: "student" },
  { id: "junior", label: "Junior", keyword: "junior" },
  { id: "middle", label: "Middle", keyword: "mid" },
  { id: "senior", label: "Senior", keyword: "senior" },
  { id: "lead", label: "Lead", keyword: "lead" },
] as const;

export type JobGrade = (typeof JOB_GRADES)[number]["id"];

export interface JobSearchQuery {
  provider: JobSearchProvider;
  /** Role / keywords, e.g. "senior backend engineer". */
  what: string;
  /** City / region / country, free text. */
  where: string;
  remoteOnly?: boolean;
  /** Seniority levels to target; empty/absent means any. */
  grades?: JobGrade[];
  /**
   * Adzuna only: the exact keyword tags a search was run with (title
   * synonyms + per-spoken-language variants, from `suggestSearchTags` when
   * `what` was left blank). Locked back into `resolvedQuery` after a search
   * so a later "load more" page fans out over the same tags instead of
   * re-deriving a possibly different set.
   */
  tags?: string[];
}

/** How long one step of a job search took, e.g. "Web search" or "Parse results" — shown under the results so a slow search says where the time went. */
export interface JobSearchStageTiming {
  label: string;
  ms: number;
}

export interface JobSearchTiming {
  totalMs: number;
  stages: JobSearchStageTiming[];
}
