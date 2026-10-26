import type { JobSearchResult } from "@/types/job-search";
import { createKeywordMatcher } from "@/features/keywords/match";

/**
 * The Search tab's "what I don't want" field ("no crypto, no gambling, no
 * on-site only, no agencies"). The AI-backed providers get the whole text as
 * an instruction; everything else works on the terms parsed out of it here.
 */

/** Kept well under `chrome.storage.sync`'s 8 KB per-item quota, which all `Preferences` share. */
export const MAX_NEGATIVE_PROMPT_LENGTH = 500;

/** A term longer than this is a sentence for the AI ("nothing that requires a security clearance"), not a keyword to match offline. */
const MAX_TERM_WORDS = 3;

// "no crypto", "not gambling", "without agencies", "без крипты", "keine Agenturen".
const LEAD_WORDS =
  /^(?:(?:no|not|non|nothing|none|without|exclude|excluding|avoid|never|any|anything|ohne|kein|keine|keinen|nicht|без|не|нет|никаких|никакой|кроме|исключить)\s+)+/iu;

/** Splits the free text into terms: one per comma/semicolon/line, lead-in negations stripped. */
export function parseNegativeTerms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const part of text.split(/[,;\n|]+/u)) {
    // The trailing space lets a bare "no" strip to nothing instead of becoming a term.
    const term = `${part.trim()} `
      .replace(LEAD_WORDS, "")
      .replace(/^[\s"'«».:!?()-]+|[\s"'«».:!?()-]+$/gu, "");
    const key = term.toLowerCase();
    if (!term || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}

/** "agencies" ↔ "agency", "recruiters" ↔ "recruiter" — enough English plural slack that an obvious match isn't missed. */
function variants(term: string): string[] {
  const out = [term];
  const lower = term.toLowerCase();
  if (/[^aeiou]ies$/.test(lower)) out.push(`${term.slice(0, -3)}y`);
  else if (/(?:s|x|z|ch|sh)es$/.test(lower)) out.push(term.slice(0, -2));
  else if (/[^s]s$/.test(lower)) out.push(term.slice(0, -1));
  else if (/[^aeiou]y$/.test(lower)) out.push(`${term.slice(0, -1)}ies`);
  else if (/(?:s|x|z|ch|sh)$/.test(lower)) out.push(`${term}es`);
  else if (/[a-z]$/.test(lower)) out.push(`${term}s`);
  return out;
}

/** The terms short enough to look up offline — longer clauses only reach the AI providers. */
export function offlineNegativeTerms(text: string): string[] {
  return parseNegativeTerms(text).filter((term) => term.split(/\s+/u).length <= MAX_TERM_WORDS);
}

export interface NegativeMatcher {
  /** The user's term that `result`'s title/company/snippet matches, or null. */
  match(result: JobSearchResult): string | null;
}

/**
 * Whole-word, Unicode-aware lookup of the negative terms in a result's
 * title, company and snippet (`keywords/match.ts`: "Java" ≠ "JavaScript").
 * Location is left out — "no on-site" must not drop a posting located in a
 * city that happens to share a word with a term.
 */
export function createNegativeMatcher(text: string): NegativeMatcher {
  const terms = offlineNegativeTerms(text);
  const keywords: string[] = [];
  const owner: string[] = [];
  for (const term of terms) {
    for (const variant of variants(term)) {
      keywords.push(variant);
      owner.push(term);
    }
  }
  const find = createKeywordMatcher(keywords);
  return {
    match(result) {
      if (keywords.length === 0) return null;
      const hit = find([result.title, result.company, result.snippet].join("\n"))[0];
      return hit ? owner[hit.keyword] : null;
    },
  };
}

export interface NegativeSplit {
  kept: JobSearchResult[];
  hidden: { result: JobSearchResult; term: string }[];
}

/** The offline pass: drops results that obviously match a negative term, whatever the provider did with the instruction. */
export function splitByNegative(results: JobSearchResult[], text: string): NegativeSplit {
  const matcher = createNegativeMatcher(text);
  const split: NegativeSplit = { kept: [], hidden: [] };
  for (const result of results) {
    const term = matcher.match(result);
    if (term) split.hidden.push({ result, term });
    else split.kept.push(result);
  }
  return split;
}

/** Prompt fragment for the AI-backed providers (web search and the parse pass); "" when nothing is excluded. */
export function negativeInstruction(text: string | undefined): string {
  const trimmed = text?.trim().slice(0, MAX_NEGATIVE_PROMPT_LENGTH);
  if (!trimmed) return "";
  return `The applicant does NOT want postings that match any of the following — skip them entirely,
even when they otherwise fit: "${trimmed.replace(/\s+/g, " ")}".`;
}

// A word that Adzuna's `what_exclude` would treat as its own excluded keyword
// but that only made sense as part of the user's phrase ("on-site only").
const ADZUNA_FILLER = new Set(["only", "jobs", "job", "roles", "role", "work", "positions", "position", "company", "companies"]);

/**
 * Adzuna's `what_exclude` drops every posting containing ANY of its
 * space-separated words, so only single plain words go in — "on-site only"
 * would otherwise exclude every posting with the word "only", and Adzuna may
 * split "on-site" itself into "on" + "site". Everything else is left to the
 * offline pass.
 */
export function adzunaExcludeWords(text: string | undefined): string {
  if (!text) return "";
  const words = parseNegativeTerms(text)
    .filter((term) => /^[\p{L}\p{N}]+$/u.test(term) && !ADZUNA_FILLER.has(term.toLowerCase()))
    .flatMap(variants);
  return [...new Set(words)].join(" ");
}

/** "linkedin.com" typed as a term — Tavily can drop those domains at the source. */
export function negativeDomains(text: string | undefined): string[] {
  if (!text) return [];
  return parseNegativeTerms(text)
    .map((term) => term.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
    .filter((term) => /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(term));
}
