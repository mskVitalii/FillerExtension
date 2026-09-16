import {
  getCustomFields,
  getCvMeta,
  getFaqAnswers,
  getLanguageLevels,
  getPersonalLegend,
  getProfile,
} from "@/features/profile/repository";
import { MODEL_LUNA, requestStructured } from "./client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary"],
  properties: {
    summary: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You write an internal candidate briefing — never shown to an employer,
used only to ground this applicant's own job search. Given their full profile, CV text,
Personal Legend, custom fields, language levels, and pre-written FAQ answers, distill
everything genuinely useful for matching them to open roles into one dense paragraph-form
summary: current/most recent title and seniority, years of experience, core skills and
technologies, industries worked in, standout achievements (with concrete numbers where the
source material has them), education, languages spoken and level, location and remote/
relocation stance, and salary expectation if stated.

Rules:
- Use ONLY facts present in the supplied data — never invent employers, titles, numbers,
  or skills.
- Be complete rather than brief: this is a grounding document for search, not a cover
  letter — include everything that could plausibly help match a job posting, even minor
  details, rather than trimming for concision. Do not pad with generic filler that carries
  no matching signal, but do not omit real facts either.
- Plain prose, no markdown, no headers, no restating these instructions.`;

/**
 * spec_5 section C, per explicit user direction: job search should be
 * grounded in everything known about the candidate, not a one-line
 * role/location string — but resending the raw CV text and Personal Legend
 * on every search call is wasteful and unfocused. This distills all of it
 * into one summary once; `profile/repository.ts#getCandidateSummary`/
 * `saveCandidateSummary` cache it exactly like Personal Legend, and the
 * job-search providers (`features/job-search/*`) use it as their grounding
 * context instead.
 */
export async function generateCandidateSummary(): Promise<string> {
  const [profile, cvMeta, legend, customFields, languageLevels, faq] = await Promise.all([
    getProfile(),
    getCvMeta(),
    getPersonalLegend(),
    getCustomFields(),
    getLanguageLevels(),
    getFaqAnswers(),
  ]);

  const userPrompt = JSON.stringify(
    {
      profile,
      cvText: cvMeta?.text ?? "",
      personalLegend: legend?.content ?? "",
      customFields,
      languageLevels,
      faq: faq.filter((f) => f.answer.trim()),
    },
    null,
    2,
  );

  const result = await requestStructured<{ summary: string }>({
    schemaName: "candidate_summary",
    schema: SCHEMA,
    model: MODEL_LUNA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { summary: string },
  });

  return result.summary;
}
