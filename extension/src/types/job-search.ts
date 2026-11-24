/**
 * Where a search result came from — shown as a small chip on every result. The search providers,
 * plus sources that aren't a search provider of their own (`linkedin`: links collected from LinkedIn
 * pages). Labels live in `features/job-search/sources.ts`.
 */
export type JobSearchSource = JobSearchProvider | "linkedin";

/** spec_5 section C: one normalized result across all search providers. */
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
  /** The source that found it first (the one whose fields the result carries). */
  source: JobSearchSource;
  /**
   * Every source that found this same posting, `source` first — set once results from several
   * sources were merged (`merge-sources.ts`); absent means just `source`. Read it with `resultSources`.
   */
  sources?: JobSearchSource[];
  /**
   * The posting has no employer/ATS link: `url` is the job board's own page (a Bundesagentur posting
   * without `externeURL`). The agent can't apply there by itself; the UI tags it.
   */
  boardOnly?: boolean;
  /** The job board's own page for this posting when `url` is the employer/ATS link (Jobsuche: the arbeitsagentur.de page). */
  boardUrl?: string;
  /**
   * Each source's own id for the posting (Jobsuche refnr, TheirStack job id, LoopCV `_id`), kept
   * through the cross-source merge — so a later search can tell a paid API which ones it already has.
   */
  sourceIds?: Partial<Record<JobSearchSource, string>>;
  /** Adzuna only: the search tag/category this result came from (spec_7 item 13) — lets the UI group results by category. */
  tag?: string;
}

/**
 * `jobsuche`: the Bundesagentur für Arbeit's job board (Germany only, `jobsuche-provider.ts`).
 * `theirstack` / `loopcv`: job APIs with the user's own key (`theirstack-provider.ts`, `loopcv-provider.ts`).
 */
export type JobSearchProvider = "openai" | "tavily" | "adzuna" | "jobsuche" | "theirstack" | "loopcv";

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
  /**
   * A set of search terms ("go developer", "backend engineer", …), each searched on its own and
   * merged — one phrase often finds nothing. When non-empty it replaces `what`
   * (`job-search/terms.ts`); `what` stays for callers that search with one phrase (the Side Panel).
   */
  terms?: string[];
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
  /** The "what I don't want" text (`job-search/negative.ts`), e.g. "no crypto, no agencies"; "" / absent excludes nothing. */
  negative?: string;
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
