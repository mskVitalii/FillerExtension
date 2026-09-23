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

Ground rules:
- Use ONLY facts present in the provided profile, CV text, and Personal Legend.
- Never invent experience, technologies, companies, education, or achievements.
- If information needed to be compelling is missing, write around it honestly
  rather than fabricating it.
- Tailor tone and emphasis to the job analysis provided.
- If "postingLanguage" is given, write the entire letter in that language,
  using the salutation, register, and closing conventions native speakers of
  it would expect on a job application (e.g. formal "Sie"/"Herr"/"Frau"
  address and a "Sehr geehrte(r) ..." opening in German, not a literal
  English-to-German translation) — unless "generationRules" explicitly asks
  for a different language.
- If "generationRules" contains applicant-specified instructions for how to
  write this letter (tone, length, structure, things to include/avoid),
  follow them as long as they don't conflict with the Ground rules above.
- Output plain prose paragraphs, no markdown headers.

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
 */
export async function generateCoverLetter(input: CoverLetterInput, onDelta?: (delta: string) => void): Promise<string> {
  const userPrompt = JSON.stringify(
    {
      profile: input.profile,
      cvText: input.cvText,
      personalLegend: input.personalLegend,
      generationRules: input.generationRules,
      job: input.job,
      analysis: input.analysis,
      postingLanguage: input.postingLanguage || undefined,
    },
    null,
    2,
  );

  const content = await requestTextStream(SYSTEM_PROMPT, userPrompt, onDelta ?? (() => {}));
  return stripEmDashes(content);
}
