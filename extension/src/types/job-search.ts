/** spec_5 section C: one normalized result across all three search providers. */
export interface JobSearchResult {
  title: string;
  company: string;
  location: string;
  url: string;
  /** Free text — a range, a single figure, or "" when the source gave none. */
  salary: string;
  snippet: string;
  source: "openai" | "tavily" | "adzuna";
  /** Adzuna only: the search tag/category this result came from (spec_7 item 13) — lets the UI group results by category. */
  tag?: string;
}

export type JobSearchProvider = "openai" | "tavily" | "adzuna";

export interface JobSearchQuery {
  provider: JobSearchProvider;
  /** Role / keywords, e.g. "senior backend engineer". */
  what: string;
  /** City / region / country, free text. */
  where: string;
  remoteOnly?: boolean;
  /**
   * Adzuna only: the exact keyword tags a search was run with (title
   * synonyms + per-spoken-language variants, from `suggestSearchTags` when
   * `what` was left blank). Locked back into `resolvedQuery` after a search
   * so a later "load more" page fans out over the same tags instead of
   * re-deriving a possibly different set.
   */
  tags?: string[];
}
