import type { Job } from "@/types/job";
import { getLocal } from "@/features/storage/local";
import { getCvMeta, getPersonalLegend, getProfile } from "@/features/profile/repository";
import { MODEL_TERRA, requestStructured } from "./client";

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

/**
 * Custom application questions (spec_2 item 5) — grounded in the same
 * sources the cover-letter pipeline uses (features/cover-letter/pipeline.ts),
 * plus the current cover letter draft itself so the answer stays consistent
 * with what the applicant already submitted. Runs on MODEL_TERRA: this text
 * goes straight into the application, same stakes as the cover letter.
 */
export async function answerCustomQuestion(question: string, job: Job): Promise<string> {
  const [profile, cvMeta, legend, coverLetter] = await Promise.all([
    getProfile(),
    getCvMeta(),
    getPersonalLegend(),
    getLocal("lastCoverLetter"),
  ]);

  const userPrompt = JSON.stringify(
    {
      question,
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
    model: MODEL_TERRA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { answer: string },
  });

  return result.answer;
}
