import type { Job } from "@/types/job";
import type { CvVariable } from "@/types/cv-template";

/**
 * Private-use characters wrapped around every substituted value when
 * `fillTemplate` runs with `mark: true` — the Side Panel preview renders
 * them as highlights so the user sees exactly what changed per posting;
 * the PDF path never marks (or strips them via `stripMarks`).
 */
export const MARK_OPEN = "";
export const MARK_CLOSE = "";
const MARKS_RE = /[]/g;

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][\w-]*)\s*\}\}/g;

export function stripMarks(text: string): string {
  return text.replace(MARKS_RE, "");
}

/** Placeholder names in order of first appearance, deduplicated. */
export function extractVariableNames(content: string): string[] {
  const names: string[] = [];
  for (const match of content.matchAll(PLACEHOLDER_RE)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

/**
 * Reconciles saved definitions with the placeholders actually present in
 * `content`: every placeholder gets a definition (new ones start empty), in
 * template order. Definitions whose placeholder is gone are kept at the end
 * rather than dropped — a typo while editing the template shouldn't wipe a
 * carefully written option list; the UI flags them as unused instead.
 */
export function syncVariables(content: string, variables: CvVariable[]): CvVariable[] {
  const names = extractVariableNames(content);
  const byName = new Map(variables.map((v) => [v.name, v]));
  const used = names.map((name) => byName.get(name) ?? { name, description: "", options: [], mode: "choice" as const });
  const orphans = variables.filter((v) => !names.includes(v.name));
  return [...used, ...orphans];
}

/**
 * Substitutes `{{name}}` with `values[name]` (empty when missing). A
 * multi-line value is marked line by line so a highlight never spans a
 * line break — the Markdown parser is line-oriented.
 */
export function fillTemplate(content: string, values: Record<string, string>, options: { mark?: boolean } = {}): string {
  return content.replace(PLACEHOLDER_RE, (_, name: string) => {
    const value = values[name] ?? "";
    if (!options.mark || !value) return value;
    return value
      .split("\n")
      .map((line) => (line ? `${MARK_OPEN}${line}${MARK_CLOSE}` : line))
      .join("\n");
  });
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function postingText(job: Job): string {
  return [job.position, job.location, job.description, ...job.requirements, ...job.responsibilities, ...job.techStack]
    .filter(Boolean)
    .join("\n");
}

/**
 * Options that literally occur in the posting, most frequent first — the
 * cheap, offline half of "pre-select what the posting already tells us"
 * (the AI pass in `openai/suggest-cv-values.ts` covers what needs judgment,
 * e.g. "Golang" → "Go", or a city that isn't in the option list).
 *
 * Word boundaries are Unicode-aware and treat `#`/`+` as part of a word, so
 * "C" doesn't match inside "C#" or "C++". Multi-line / long options (whole
 * swappable blocks) are skipped — they never appear verbatim in a posting.
 */
export function findOptionsInPosting(options: string[], job: Job): string[] {
  const haystack = postingText(job);
  if (!haystack) return [];
  const counts = new Map<string, number>();
  for (const option of options) {
    const needle = option.trim();
    if (!needle || needle.includes("\n") || needle.length > 60) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}#+])${escapeRegExp(needle)}(?![\\p{L}\\p{N}#+])`, "giu");
    const count = haystack.match(re)?.length ?? 0;
    if (count > 0) counts.set(option, count);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([option]) => option);
}

/** Offline starting value before (or without) the AI pass: the most-mentioned option, else the first one. */
export function defaultValue(variable: CvVariable, job: Job): string {
  return findOptionsInPosting(variable.options, job)[0] ?? variable.options[0] ?? "";
}
