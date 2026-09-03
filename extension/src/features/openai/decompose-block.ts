import type { FieldDescriptor } from "@/features/autofill/pick-questions";
import { MODEL_LUNA, requestStructured } from "./client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["questions"],
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "question"],
        properties: {
          index: { type: "integer" },
          question: { type: "string" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You are given a block of a job-application form: its visible text, and a
list of the input fields inside it. For each field that asks the applicant
something, return the question it is asking, phrased as a plain question.

Rules:
- Use ONLY the visible text provided. Never invent a question.
- Match each question to its field by "index".
- Omit a field that is not a real question (layout helper, hidden field,
  search box, honeypot, a plain "First name"-style profile field).
- A field with "options" is a multiple-choice question — still return only
  its question text, not the options.
- Output the question text only — no numbering, no "Question:" prefix.
- Questions may be in any language; keep the form's own language.`;

interface RawQuestion {
  index: number;
  question: string;
}

/**
 * AI fallback for the visual picker: when the deterministic pass
 * (`pick-questions.ts`) couldn't attach a question to a picked field, the
 * block's visible text plus the field descriptors go to MODEL_LUNA — same
 * tier and rationale as the automatic question answering. Returns questions
 * keyed by the descriptor `index`; fields the model skipped are absent.
 */
export async function decomposeBlock(
  blockText: string,
  fields: FieldDescriptor[],
): Promise<Record<number, string>> {
  if (fields.length === 0) return {};

  const userPrompt = JSON.stringify({ blockText: blockText.slice(0, 6000), fields }, null, 2);

  const result = await requestStructured<{ questions: RawQuestion[] }>({
    schemaName: "block_questions",
    schema: SCHEMA,
    model: MODEL_LUNA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { questions: RawQuestion[] },
  });

  const out: Record<number, string> = {};
  for (const q of result.questions) {
    if (q.question.trim()) out[q.index] = q.question.trim();
  }
  return out;
}
