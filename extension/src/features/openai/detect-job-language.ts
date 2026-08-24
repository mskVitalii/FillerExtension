import type { Job, JobLanguageInfo } from "@/types/job";
import { CEFR_LEVELS } from "@/lib/language-level";
import { MODEL_LUNA, requestStructured } from "./client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["postingLanguages", "requirements"],
  properties: {
    postingLanguages: { type: "array", items: { type: "string" } },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["language", "level"],
        properties: {
          language: { type: "string" },
          level: { type: ["string", "null"], enum: [...CEFR_LEVELS, null] },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You read a job posting and report its language(s) and any explicit
language-proficiency requirement it states.

- postingLanguages: the language(s) the posting text itself is written in (e.g. "English").
- requirements: any language the posting explicitly asks the applicant to know or be
  proficient in, with a level. Map loose phrasing to the nearest CEFR level (A1-C2, or
  "Native" for "native speaker"/"muttersprachlich") when you reasonably can — e.g. "fluent",
  "professional working proficiency" -> "C1"; "conversational" -> "B1". If a language is
  mentioned but no level can be reasonably inferred, set level to null. Do not invent a
  requirement that isn't stated in the text. If nothing is stated, return an empty array.`;

/**
 * Runs automatically on every job load (spec_3 item 2) — separate from the cover-letter
 * pipeline's job analysis, which only runs when the user clicks Generate. Uses MODEL_LUNA
 * (spec_2 item 4): this must stay fast since it's not gated behind a user action.
 */
export async function detectJobLanguage(job: Job): Promise<JobLanguageInfo> {
  return requestStructured<JobLanguageInfo>({
    schemaName: "job_language",
    schema: SCHEMA,
    model: MODEL_LUNA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: JSON.stringify(job, null, 2),
    parse: (raw) => JSON.parse(raw) as JobLanguageInfo,
  });
}
