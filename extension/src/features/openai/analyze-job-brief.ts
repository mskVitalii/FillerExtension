import type { Job, JobKeyword, JobLanguageInfo } from "@/types/job";
import { CEFR_LEVELS } from "@/lib/language-level";
import { getApplicantContext } from "@/features/profile/context";
import { getJobAnalysisModel, requestStructured } from "./client";

export interface JobBrief {
  language: JobLanguageInfo;
  keywords: JobKeyword[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["postingLanguages", "requirements", "keywords"],
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
    keywords: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "matchesProfile"],
        properties: {
          text: { type: "string" },
          matchesProfile: { type: "boolean" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You read a job posting and report two independent things about it: its
language, and its notable keywords. Judge each against the applicant profile/CV/Personal
Legend given below.

LANGUAGE
- postingLanguages: the language(s) the posting text itself is written in (e.g. "English").
- requirements: any language the posting explicitly asks the applicant to know or be
  proficient in, with a level. Map loose phrasing to the nearest CEFR level (A1-C2, or
  "Native" for "native speaker"/"muttersprachlich") when you reasonably can — e.g. "fluent",
  "professional working proficiency" -> "C1"; "conversational" -> "B1". If a language is
  mentioned but no level can be reasonably inferred, set level to null. Do not invent a
  requirement that isn't stated in the text. If nothing is stated, return an empty array.

KEYWORDS
- Pick the notable keywords/key phrases out of the posting — the skills, tools,
  technologies, qualifications, and requirements a candidate would want to notice at a
  glance.
- Every keyword's "text" MUST be copied VERBATIM from the posting text (job title,
  description, requirements, responsibilities) — the exact same characters and casing, not
  a paraphrase, synonym, or translation — because the extension re-finds this exact text on
  the page to highlight it. A keyword that doesn't appear verbatim in the text is useless.
- Prefer short phrases: single words or 2-3 word phrases (e.g. "TypeScript", "Kubernetes",
  "5+ years", "product management", "Bachelor's degree") — not full sentences.
- Pick 8-15 of the most important ones. Skip generic filler ("team player", "fast-paced
  environment") unless the posting has almost nothing more specific.
- No duplicates, and no two keywords where one is a substring of the other (keep the more
  specific/longer one).
- Set "matchesProfile" to true when the applicant's profile/cvText/personalLegend shows they
  already have, use, or meet that skill/tool/technology/qualification — false when the
  posting asks for it but nothing in the applicant's material supports it. Judge substance,
  not exact wording (e.g. "Kubernetes" counts as a match if the CV mentions "container
  orchestration with K8s" or "EKS"). When genuinely unsure, set it to false — this flags a
  possible gap for the applicant to address rather than silently hiding it.`;

interface RawResult {
  postingLanguages: string[];
  requirements: JobLanguageInfo["requirements"];
  keywords: JobKeyword[];
}

/**
 * Combines what used to be `detectJobLanguage` + `extractJobKeywords` into a single
 * MODEL_LUNA call — both run automatically on every job load, over the same `job` and the
 * same applicant context, so splitting them into two round trips only doubled network/latency
 * without any independent benefit. The stable applicant-context fields are placed first in the
 * user prompt (ahead of the per-job `job` field) so that block stays a byte-identical prefix
 * across successive job analyses in the same session, which is what OpenAI's automatic prompt
 * caching keys off.
 */
export async function analyzeJobBrief(job: Job): Promise<JobBrief> {
  const context = await getApplicantContext();

  const userPrompt = JSON.stringify(
    {
      profile: context.profile,
      cvText: context.cvText,
      personalLegend: context.personalLegend,
      job,
    },
    null,
    2,
  );

  const result = await requestStructured<RawResult>({
    schemaName: "job_brief",
    schema: SCHEMA,
    model: await getJobAnalysisModel(),
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as RawResult,
  });

  return {
    language: { postingLanguages: result.postingLanguages, requirements: result.requirements },
    keywords: result.keywords,
  };
}
