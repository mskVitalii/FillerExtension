import type { Job } from "@/types/job";
import type { Profile } from "@/types/profile";
import { requestTextStream } from "./client";
import { HOUSE_STYLE_RULES, stripEmDashes } from "./house-style";
import type { JobAnalysis } from "./job-analysis";

export interface CoverLetterInput {
  profile: Profile;
  cvText: string;
  personalLegend: string;
  /** Applicant-authored instructions for tone/length/structure (spec_7 item 7) — distinct from the factual Personal Legend. */
  generationRules: string;
  job: Job;
  analysis: JobAnalysis;
  /** The posting's detected language (JobLanguageInfo.postingLanguages[0]) — the letter is written in it when given (spec_8 item 4). */
  postingLanguage?: string;
}

const SYSTEM_PROMPT = `You write tailored cover letters for job applications.

The user message holds the applicant's data as JSON, and may end with an
"Applicant's rules" section written by the applicant themselves.

Priority, highest first. When two of these conflict, the higher one wins:
1. Facts. Use ONLY facts present in the provided profile, CV text, and
   Personal Legend. Never invent experience, technologies, companies,
   education, or achievements, even if the applicant's rules ask for them.
   If information needed to be compelling is missing, write around it
   honestly rather than fabricating it.
2. The applicant's rules. Follow every instruction there on tone, length,
   structure, language, and what to include or avoid, including where it
   departs from the defaults below. Every rule there applies to the whole
   letter, not just the opening.
3. Language. If "postingLanguage" is given, write the entire letter in that
   language, using the salutation, register, and closing conventions native
   speakers of it would expect on a job application (e.g. formal
   "Sie"/"Herr"/"Frau" address and a "Sehr geehrte(r) ..." opening in German,
   not a literal English-to-German translation).
4. The house style below. Its "no exceptions" means no exceptions of your
   own; an explicit applicant rule still overrides it.
5. Tone and emphasis tailored to the job analysis provided.

Output plain prose paragraphs, no markdown headers.

${HOUSE_STYLE_RULES}`;

/**
 * Stage 2 of the cover-letter pipeline (spec section 15-16). Consumes the
 * stage-1 analysis plus grounded user context; produces a single tailored
 * letter. Streamed (`requestTextStream`, plain text — not Structured Output,
 * which can't usefully render mid-generation): the longest-running,
 * user-watched generation in the app, so `onDelta` lets the Side Panel show
 * the letter appearing live instead of a blank editor until the whole thing
 * lands. `stripEmDashes` still runs once on the assembled result — a
 * mid-stream chunk can end on a dash the next chunk turns into a comma, so
 * cleanup only makes sense against the full text.
 *
 * The applicant's rules go last, as plain text outside the JSON: buried
 * between the CV and the posting they read as one more data field and got
 * drifted from.
 */
export async function generateCoverLetter(input: CoverLetterInput, onDelta?: (delta: string) => void): Promise<string> {
  const data = JSON.stringify(
    {
      profile: input.profile,
      cvText: input.cvText,
      personalLegend: input.personalLegend,
      job: input.job,
      analysis: input.analysis,
      postingLanguage: input.postingLanguage || undefined,
    },
    null,
    2,
  );
  const userPrompt = data + applicantRulesSection(input.generationRules);

  const content = await requestTextStream(SYSTEM_PROMPT, userPrompt, onDelta ?? (() => {}));
  return stripEmDashes(content);
}

/**
 * The applicant's generation rules as the closing section of a user prompt,
 * or "" when they wrote none. Shared with the polish pass so it doesn't
 * "fix" what the applicant explicitly asked for.
 */
export function applicantRulesSection(rules: string): string {
  const trimmed = rules.trim();
  if (!trimmed) return "";
  return `\n\n## Applicant's rules (highest priority after facts)\n\n${trimmed}\n`;
}
