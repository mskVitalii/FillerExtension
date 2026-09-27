import { requestStructured } from "./client";
import { HOUSE_STYLE_RULES, stripEmDashes } from "./house-style";
import type { SlopFinding } from "@/features/cover-letter/slop-detector";
import { applicantRulesSection } from "./cover-letter";

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
letter's last concrete point instead. Replace every em dash ("—") with a
comma, a period, or parentheses.

The user message may end with the applicant's own rules for the letter. If a
flagged pattern is something those rules explicitly ask for, leave it as is:
the applicant's rules outrank the house style.

Do not introduce any new AI-slop while editing. For reference, the full
house style is:

${HOUSE_STYLE_RULES}

Output plain prose paragraphs, no markdown headers.`;

/**
 * Editor pass (spec sections 15-16 + the `no-ai-slop` skill): runs only
 * when `detectSlop` found something, so most generations skip this call
 * entirely. Takes the exact findings so the model fixes only what was
 * actually flagged rather than rewriting freely. Sees the applicant's
 * generation rules too, so it doesn't undo what they explicitly asked for.
 */
export async function polishCoverLetter(
  content: string,
  findings: SlopFinding[],
  generationRules = "",
): Promise<string> {
  const userPrompt =
    JSON.stringify(
      {
        draft: content,
        flaggedPatterns: findings.map((f) => `${f.pattern}: "${f.match}"`),
      },
      null,
      2,
    ) + applicantRulesSection(generationRules);

  const result = await requestStructured<{ content: string }>({
    schemaName: "cover_letter_polish",
    schema: SCHEMA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { content: string },
  });

  return stripEmDashes(result.content);
}
