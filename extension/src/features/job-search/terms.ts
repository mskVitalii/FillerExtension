import type { JobSearchQuery } from "@/types/job-search";

/** A term longer than this is a sentence, not a search term; web search engines and Adzuna match short phrases. */
export const MAX_TERM_LENGTH = 80;

/** Trimmed, length-capped, without blanks and case-insensitive repeats, in the given order. */
export function cleanTerms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of terms) {
    const term = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TERM_LENGTH).trim();
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/**
 * What a search looks for: its `terms`, or the single `what` phrase of callers that still send one;
 * [] means "derive it from the CV".
 */
export function searchTerms(query: Pick<JobSearchQuery, "what" | "terms">): string[] {
  const terms = cleanTerms(query.terms ?? []);
  if (terms.length > 0) return terms;
  return cleanTerms([query.what ?? ""]);
}
