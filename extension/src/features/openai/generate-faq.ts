import { getApplicantContext } from "@/features/profile/context";
import type { FaqEntry } from "@/types/profile";
import { requestStructured } from "./client";
import { HOUSE_STYLE_RULES, stripEmDashes } from "./house-style";

const SYSTEM_PROMPT = `You write the applicant's own answers to standard interview-FAQ
questions (spec_5 section B) — general-purpose answers meant to be reused, as-is or
lightly adapted, whenever a real application form asks a close variant of one of them.

Ground rules:
- Use ONLY facts present in the provided profile, CV text, Personal Legend, and
  custom fields. Never invent experience, technologies, companies, education,
  achievements, or a concrete salary figure that wasn't actually given.
- If information needed for a good answer is missing (no CV, no Personal Legend
  content covering it), write a short, honest, generically true answer rather
  than fabricating specifics — the applicant can always sharpen it later.
- Keep each answer 2-5 sentences: concrete and confident, never generic
  corporate filler, no restating the question.
- If "generationRules" contains applicant-specified instructions for how
  their text should be written (tone, things to include/avoid), follow them
  as long as they don't conflict with the Ground rules above.
- Output plain text per answer, no markdown, no numbering.

${HOUSE_STYLE_RULES}`;

function schemaFor(count: number) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["answers"],
    properties: {
      answers: {
        type: "array",
        minItems: count,
        maxItems: count,
        items: { type: "string" },
      },
    },
  } as const;
}

/**
 * Generates answers for whichever FAQ questions don't already have one
 * (spec_5 section B: "if they don't exist — generate from CV and legend").
 * Returns only the newly generated entries; the caller merges them over
 * whatever's already cached.
 */
export async function generateFaqAnswers(questions: string[]): Promise<FaqEntry[]> {
  if (questions.length === 0) return [];

  const { profile, cvText, personalLegend, generationRules, customFields } = await getApplicantContext();

  // Static applicant context first, the actual per-call variable ("questions") last — keeps
  // repeat calls (re-running for newly added FAQ questions later) sharing a stable, cacheable
  // prefix instead of diverging from the very first key.
  const userPrompt = JSON.stringify(
    {
      profile,
      cvText,
      personalLegend,
      generationRules,
      customFields,
      questions,
    },
    null,
    2,
  );

  const result = await requestStructured<{ answers: string[] }>({
    schemaName: "faq_answers",
    schema: schemaFor(questions.length),
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { answers: string[] },
  });

  return questions.map((question, i) => ({
    question,
    answer: stripEmDashes(result.answers[i] ?? ""),
  }));
}

/** Generates only for questions in `all` that `existing` doesn't already answer, merged back over `existing`. */
export async function fillMissingFaqAnswers(all: string[], existing: FaqEntry[]): Promise<FaqEntry[]> {
  const answered = new Map(existing.map((e) => [e.question, e.answer]));
  const missing = all.filter((q) => !answered.get(q)?.trim());
  const generated = await generateFaqAnswers(missing);
  for (const entry of generated) answered.set(entry.question, entry.answer);
  return all.map((question) => ({ question, answer: answered.get(question) ?? "" }));
}
