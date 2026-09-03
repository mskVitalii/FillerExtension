import type { Job } from "@/types/job";
import { getLocal } from "@/features/storage/local";
import { getCvMeta, getPersonalLegend, getProfile } from "@/features/profile/repository";
import { MODEL_LUNA, requestStructured } from "./client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You answer a custom question from a job application form on the
applicant's behalf.

Ground rules:
- Use ONLY facts present in the provided profile, CV text, Personal Legend,
  cover letter, and job posting. Never invent experience, technologies,
  companies, education, or achievements.
- If information needed to answer well is missing, answer honestly and
  briefly rather than fabricating it.
- Match the question's expected length: a short field gets a short answer, an
  open-ended "tell us about..." field gets a fuller one.
- Output plain text, no markdown, no restating the question.`;

const CHOICE_RULE = `
- This is a MULTIPLE-CHOICE question: "options" lists the allowed answers.
  Reply with EXACTLY ONE option, copied verbatim, and nothing else.
- Base the choice on the applicant's profile/CV/Personal Legend. If the
  needed fact is genuinely absent (e.g. pronouns not stated anywhere),
  prefer a neutral option, an explicit "prefer not to say", or the option
  that commits the applicant least.`;

/**
 * Custom application questions (spec_2 item 5) — grounded in the same
 * sources the cover-letter pipeline uses (features/cover-letter/pipeline.ts),
 * plus the current cover letter draft itself so the answer stays consistent
 * with what the applicant already submitted. Runs on MODEL_LUNA: these are
 * mostly short, factual form fields (previous employer, notice period,
 * referral name), answered automatically for every detected question the
 * moment the Side Panel opens on a posting — latency and cost per open
 * matter more here than the extra nuance MODEL_TERRA would add.
 */
export async function answerCustomQuestion(question: string, job: Job, options?: string[]): Promise<string> {
  const [profile, cvMeta, legend, coverLetter] = await Promise.all([
    getProfile(),
    getCvMeta(),
    getPersonalLegend(),
    getLocal("lastCoverLetter"),
  ]);

  const userPrompt = JSON.stringify(
    {
      question,
      options: options && options.length > 0 ? options : undefined,
      job,
      profile,
      cvText: cvMeta?.text ?? "",
      personalLegend: legend?.content ?? "",
      coverLetter: coverLetter ?? "",
    },
    null,
    2,
  );

  const result = await requestStructured<{ answer: string }>({
    schemaName: "custom_question_answer",
    schema: SCHEMA,
    model: MODEL_LUNA,
    systemPrompt: options && options.length > 0 ? `${SYSTEM_PROMPT}\n${CHOICE_RULE}` : SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { answer: string },
  });

  return result.answer;
}
