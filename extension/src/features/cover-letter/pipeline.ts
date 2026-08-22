import type { Job } from "@/types/job";
import { analyzeJob } from "@/features/openai/job-analysis";
import { generateCoverLetter } from "@/features/openai/cover-letter";
import { polishCoverLetter } from "@/features/openai/polish-cover-letter";
import { getCvMeta, getPersonalLegend, getProfile } from "@/features/profile/repository";
import { detectSlop, type SlopFinding } from "./slop-detector";

export interface CoverLetterPipelineResult {
  content: string;
  /** Patterns found in the first draft, per the `no-ai-slop` rule set — empty when it was clean. */
  slopFindings: SlopFinding[];
  /** True when the editor pass ran and changed the draft to fix `slopFindings`. */
  cleaned: boolean;
}

/**
 * Full pipeline (spec section 15): Job extraction → Structured Job →
 * Job analysis → Cover Letter generation → AI-slop validation. The last
 * step ports the `no-ai-slop` skill's detection rules: a generic,
 * AI-sounding letter defeats the "tailored to this job" goal just as
 * badly as a fabricated fact would, so a single editor pass runs only
 * when the draft actually trips one of those patterns.
 */
export async function runCoverLetterPipeline(job: Job): Promise<CoverLetterPipelineResult> {
  const [profile, cvMeta, legend] = await Promise.all([getProfile(), getCvMeta(), getPersonalLegend()]);

  const analysis = await analyzeJob(job);

  const draft = await generateCoverLetter({
    profile,
    cvText: cvMeta?.text ?? "",
    personalLegend: legend?.content ?? "",
    job,
    analysis,
  });

  const slopFindings = detectSlop(draft);
  if (slopFindings.length === 0) {
    return { content: draft, slopFindings, cleaned: false };
  }

  const polished = await polishCoverLetter(draft, slopFindings);
  return { content: polished, slopFindings, cleaned: true };
}
