import type { Job } from "@/types/job";
import type { CvMeta } from "@/types/profile";
import { languageCode, languageName } from "@/lib/language-codes";

/**
 * Picks which CV from the library to use for one posting, offline:
 * 1. the posting's language (detected by the job brief, else guessed from its text),
 * 2. among the CVs in that language, the one whose `rules` best match the posting,
 * 3. else the one marked default for that language, else the first one in it.
 * With no CV in the posting's language, the English default stands in (most
 * postings in Germany accept English), else nothing is picked and the active
 * CV stays.
 */

export interface CvChoice {
  cvId: string;
  /** Short human explanation, shown next to the picked CV. */
  reason: string;
  source: "language" | "rules" | "ai" | "manual";
}

const STOPWORDS: Record<string, string[]> = {
  de: ["und", "der", "die", "das", "mit", "für", "wir", "sie", "ihre", "eine", "nicht", "auf", "bei", "unser", "kenntnisse", "erfahrung"],
  en: ["and", "the", "with", "for", "you", "your", "our", "we", "are", "will", "experience", "team", "skills", "role"],
};

/** Cheap guess at a posting's language from its text, for when the AI brief isn't available. Only de/en. */
export function guessTextLanguage(text: string): string | null {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  if (words.length < 20) return null;
  const counts = Object.fromEntries(
    Object.entries(STOPWORDS).map(([code, list]) => {
      const set = new Set(list);
      return [code, words.filter((w) => set.has(w)).length];
    }),
  ) as Record<string, number>;
  const [best, second] = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!best || best[1] < 3 || best[1] < second[1] * 1.5) return null;
  return best[0];
}

/** The posting's language code: the brief's first posting language, else a guess from the text. */
export function postingLanguageCode(job: Job, postingLanguages: string[] | undefined): string | null {
  for (const language of postingLanguages ?? []) {
    const code = languageCode(language);
    if (code) return code;
  }
  return guessTextLanguage([job.position, job.description, ...job.requirements].join("\n"));
}

/** Rule words, 2+ characters so "Go"/"C#" count, minus the de/en filler words. */
function tokens(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}+#]{2,}/gu) ?? []).filter((w) => !STOPWORDS.en.includes(w) && !STOPWORDS.de.includes(w));
}

/** Whole-word match, so the rule "go" doesn't hit "good". */
function containsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}+#])`, "u").test(text);
}

/** How many of a CV's rule words occur in the posting — title words count triple. 0 for a CV without rules. */
export function rulesScore(rules: string | undefined, job: Job): number {
  if (!rules?.trim()) return 0;
  const title = job.position.toLowerCase();
  const body = [job.description, ...job.requirements, ...job.responsibilities, ...job.techStack].join("\n").toLowerCase();
  let score = 0;
  for (const word of new Set(tokens(rules))) {
    if (containsWord(title, word)) score += 3;
    else if (containsWord(body, word)) score += 1;
  }
  return score;
}

export function cvDisplayName(cv: Pick<CvMeta, "name" | "fileName">): string {
  return cv.name?.trim() || cv.fileName;
}

export function pickCvForPosting(cvs: CvMeta[], job: Job, postingLanguages?: string[]): CvChoice | null {
  if (cvs.length === 0) return null;
  const language = postingLanguageCode(job, postingLanguages);
  if (!language) return null;
  const inLanguage = cvs.filter((cv) => cv.language === language);
  if (inLanguage.length === 0) {
    const fallback = cvs.find((cv) => cv.language === "en" && cv.isDefaultForLanguage) ?? cvs.find((cv) => cv.language === "en");
    if (!fallback) return null;
    return { cvId: fallback.id, reason: `no ${languageName(language)} CV, English instead`, source: "language" };
  }
  const scored = inLanguage
    .map((cv) => ({ cv, score: rulesScore(cv.rules, job) }))
    .sort((a, b) => b.score - a.score || Number(Boolean(b.cv.isDefaultForLanguage)) - Number(Boolean(a.cv.isDefaultForLanguage)));
  const best = scored[0];
  if (best.score > 0 && (scored.length === 1 || best.score > scored[1].score)) {
    return { cvId: best.cv.id, reason: `${languageName(language)} posting, matches its rules`, source: "rules" };
  }
  const chosen = inLanguage.find((cv) => cv.isDefaultForLanguage) ?? inLanguage[0];
  return { cvId: chosen.id, reason: `${languageName(language)} posting`, source: "language" };
}

/** Marks `id` default for its language and clears the flag on every other CV in that language. */
export function withDefaultForLanguage(cvs: CvMeta[], id: string): CvMeta[] {
  const target = cvs.find((cv) => cv.id === id);
  if (!target?.language) return cvs;
  return cvs.map((cv) =>
    cv.language === target.language ? { ...cv, isDefaultForLanguage: cv.id === id } : cv,
  );
}
