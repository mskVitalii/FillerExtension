import { requestStructured } from "./client";
import type { SlopFinding } from "@/features/cover-letter/slop-detector";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content"],
  properties: {
    content: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You are a sharp human editor cleaning up a cover letter draft.

Fix ONLY the flagged AI-writing patterns listed below. Make the minimum
effective edit — do not rewrite sentences that were not flagged, do not
change facts, experience, technologies, or claims, and do not add new
content. Replace banned words/clichés with plain, concrete language.
Rewrite "not X, it's Y" contrasts as a direct statement of Y. Cut
throat-clearing openers, weasel attribution, and importance-puffery instead
of softening them. If the ending is a generic summary/recap, end on the
letter's last concrete point instead.

Output plain prose paragraphs, no markdown headers.`;

/**
 * Editor pass (spec sections 15-16 + the `no-ai-slop` skill): runs only
 * when `detectSlop` found something, so most generations skip this call
 * entirely. Takes the exact findings so the model fixes only what was
 * actually flagged rather than rewriting freely.
 */
export async function polishCoverLetter(content: string, findings: SlopFinding[]): Promise<string> {
  const userPrompt = JSON.stringify(
    {
      draft: content,
      flaggedPatterns: findings.map((f) => `${f.pattern}: "${f.match}"`),
    },
    null,
    2,
  );

  const result = await requestStructured<{ content: string }>({
    schemaName: "cover_letter_polish",
    schema: SCHEMA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { content: string },
  });

  return result.content;
}
