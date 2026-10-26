/**
 * Whole-word keyword matching shared by everything that looks a skill up in
 * text: the on-page highlight, the DOM tech-stack pass, and the CV variant
 * pre-selection. A plain `\b` is ASCII-only and treats `+`/`#`/`.` as
 * boundaries, so it finds "Go" in "Google", can never match the end of
 * "C++", and breaks on Cyrillic. Instead a keyword must not be glued to:
 * - a letter, combining mark, digit or `_` (any script): "Java" ≠ "JavaScript";
 * - `#` or `+`: "C" ≠ "C#"/"C++";
 * - a `.` that itself joins two word characters: "Node" ≠ "Node.js",
 *   "NET" ≠ "ASP.NET". A sentence-ending "Java." still matches.
 *
 * Acronyms and very short keywords match case-sensitively — "IT"/"REST"/"Go"
 * would otherwise light up every "it"/"rest"/"go" in ordinary prose. Anything
 * else is case-insensitive, and a space in a keyword matches any whitespace
 * run (a wrapped line, a `&nbsp;`).
 */

const WORD = "\\p{L}\\p{M}\\p{N}_";
const BEFORE = `(?<![${WORD}#+])(?<![${WORD}]\\.)`;
const AFTER = `(?![${WORD}#+])(?!\\.[${WORD}])`;

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** "Go", "R", "IT", "AWS", "C#" — matched with exact case. */
export function isCaseSensitiveKeyword(keyword: string): boolean {
  return [...keyword].length <= 2 || !/\p{Ll}/u.test(keyword);
}

function body(keyword: string): string {
  return escapeRegExp(keyword.trim()).replace(/\s+/g, "\\s+");
}

/** One keyword with word boundaries, `g`+`u` flags, `i` unless it's case-sensitive. */
export function keywordRegExp(keyword: string): RegExp {
  return new RegExp(`${BEFORE}${body(keyword)}${AFTER}`, isCaseSensitiveKeyword(keyword) ? "gu" : "giu");
}

export function countKeyword(text: string, keyword: string): number {
  if (!keyword.trim()) return 0;
  return text.match(keywordRegExp(keyword))?.length ?? 0;
}

export function containsKeyword(text: string, keyword: string): boolean {
  return countKeyword(text, keyword) > 0;
}

export interface KeywordMatch {
  index: number;
  /** The matched text as it appears in the scanned text. */
  text: string;
  /** Index into the `keywords` the matcher was built from. */
  keyword: number;
}

/**
 * Finds every non-overlapping occurrence of any of `keywords` in one pass.
 * Longer keywords win where two overlap ("React Native" over "React"). One
 * regex runs case-insensitively with a capture group per keyword; a hit on a
 * case-sensitive keyword whose case differs is discarded and scanning resumes
 * one character later.
 */
export function createKeywordMatcher(keywords: string[]): (text: string) => KeywordMatch[] {
  const order = keywords
    .map((keyword, index) => ({ keyword: keyword.trim(), index }))
    .filter((entry) => entry.keyword.length > 0)
    .sort((a, b) => b.keyword.length - a.keyword.length);
  if (order.length === 0) return () => [];

  const pattern = new RegExp(`${BEFORE}(?:${order.map((entry) => `(${body(entry.keyword)})`).join("|")})${AFTER}`, "giu");
  const exact = order.map((entry) =>
    isCaseSensitiveKeyword(entry.keyword) ? new RegExp(`^${body(entry.keyword)}$`, "u") : null,
  );

  return (text) => {
    const matches: KeywordMatch[] = [];
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      const group = match.slice(1).findIndex((value) => value !== undefined);
      if (exact[group] && !exact[group].test(match[0])) {
        pattern.lastIndex = match.index + 1;
        continue;
      }
      matches.push({ index: match.index, text: match[0], keyword: order[group].index });
    }
    return matches;
  };
}
