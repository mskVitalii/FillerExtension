import type { Job } from "@/types/job";
import { MODEL_TERRA, requestStructured } from "./client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content"],
  properties: {
    content: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You are editing an existing cover letter draft on the applicant's
instructions.

Ground rules:
- Apply ONLY the change the applicant asked for. Do not rewrite parts of the
  letter the instruction didn't touch.
- Never invent experience, technologies, companies, education, or achievements
  that aren't already in the draft or the job context provided.
- Keep the same language the draft is currently written in unless the
  instruction explicitly asks to change it.
- Output plain prose paragraphs, no markdown headers.`;

/**
 * Cover-letter "Improve" pass (spec_2 item 3): free-text instructions from
 * the applicant ("make this shorter", "emphasize the Kubernetes work") drive
 * a targeted edit of the current draft, grounded in the same job context the
 * original generation used. Runs on MODEL_TERRA — this text goes straight
 * into the application, same stakes as the original draft.
 */
export async function reviseCoverLetter(content: string, instructions: string, job: Job): Promise<string> {
  const userPrompt = JSON.stringify({ draft: content, instructions, job }, null, 2);

  const result = await requestStructured<{ content: string }>({
    schemaName: "cover_letter_revision",
    schema: SCHEMA,
    model: MODEL_TERRA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { content: string },
  });

  return result.content;
}
