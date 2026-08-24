import { MODEL_LUNA, requestStructured } from "./client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content"],
  properties: {
    content: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You translate a cover letter for the applicant's own understanding —
not for submission. Translate faithfully, preserve paragraph breaks, and keep
names, companies, and technical terms as-is where translating them would be
unnatural. Output plain prose paragraphs, no markdown headers, no notes about
the translation itself.`;

/**
 * Cover-letter "Translate" tab (spec_2 item 3): a personal-understanding
 * translation the applicant reads, not a second submission artifact — kept
 * in sync with the draft by the caller re-running this on every edit.
 * Mechanical task, so it runs on MODEL_LUNA (spec_2 item 4).
 */
export async function translateCoverLetter(content: string, targetLanguage: string): Promise<string> {
  const userPrompt = JSON.stringify({ content, targetLanguage }, null, 2);

  const result = await requestStructured<{ content: string }>({
    schemaName: "cover_letter_translation",
    schema: SCHEMA,
    model: MODEL_LUNA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { content: string },
  });

  return result.content;
}
