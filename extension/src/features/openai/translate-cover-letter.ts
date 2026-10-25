import { requestStructured } from "./client";
import { stripEmDashes } from "./house-style";
import { CONTENT_SCHEMA, type ContentResult } from "./schemas";

const SYSTEM_PROMPT = `You translate a cover letter for the applicant's own understanding —
not for submission. Translate faithfully, preserve paragraph breaks, and keep
names, companies, and technical terms as-is where translating them would be
unnatural. Do not use em dashes ("—"); use commas or periods. Output plain
prose paragraphs, no markdown headers, no notes about the translation itself.`;

/**
 * Cover-letter "Translate" tab (spec_2 item 3): a personal-understanding
 * translation the applicant reads, not a second submission artifact — kept
 * in sync with the draft by the caller re-running this on every edit.
 * Mechanical task, so it runs on MODEL_LUNA (spec_2 item 4).
 */
export async function translateCoverLetter(content: string, targetLanguage: string): Promise<string> {
  const userPrompt = JSON.stringify({ content, targetLanguage }, null, 2);

  const result = await requestStructured<ContentResult>({
    schemaName: "cover_letter_translation",
    schema: CONTENT_SCHEMA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as ContentResult,
  });

  return stripEmDashes(result.content);
}
