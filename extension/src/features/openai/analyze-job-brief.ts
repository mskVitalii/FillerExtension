import type { Job, JobBrief, JobKeyword, JobLanguageInfo } from "@/types/job";
import { CEFR_LEVELS } from "@/lib/language-level";
import { getApplicantContext } from "@/features/profile/context";
import { KEYWORDS_SCHEMA, keywordRules } from "@/features/keywords/prompt";
import { filterJobKeywords } from "@/features/keywords/filter";
import { getJobAnalysisModel, requestStructured } from "./client";

export type { JobBrief };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["postingLanguages", "requirements", "keywords", "contact"],
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
    keywords: KEYWORDS_SCHEMA,
    contact: { type: ["string", "null"] },
  },
} as const;

const SYSTEM_PROMPT = `You read a job posting and report three independent things about it: its
language, the skills it asks for (keywords), and (only if asked below) a recruiter/hiring
contact. Judge language and keywords against the applicant profile/CV/Personal Legend given
below.

LANGUAGE
- postingLanguages: the language(s) the posting text itself is written in (e.g. "English").
- requirements: any language the posting explicitly asks the applicant to know or be
  proficient in, with a level. Map loose phrasing to the nearest CEFR level (A1-C2, or
  "Native" for "native speaker"/"muttersprachlich") when you reasonably can — e.g. "fluent",
  "professional working proficiency" -> "C1"; "conversational" -> "B1". If a language is
  mentioned but no level can be reasonably inferred, set level to null. Do not invent a
  requirement that isn't stated in the text. If nothing is stated, return an empty array.

${keywordRules("the posting text (job title, description, requirements, responsibilities)")}

CONTACT
- "job.contact" below is the recruiter/hiring contact already found elsewhere, or null if none
  was found yet.
- If it is already set (not null), ignore this entirely and return "contact": null — there is
  nothing to add.
- If it is null, look for one in the job's own text (description/requirements/responsibilities):
  a named recruiter/hiring manager's email address, or a LinkedIn profile/company URL. If you
  find one, copy it VERBATIM (exact characters) so it can be re-found on the page for
  highlighting — the same rule as for keywords. If none is mentioned, return "contact": null.`;

interface RawResult {
  postingLanguages: string[];
  requirements: JobLanguageInfo["requirements"];
  keywords: JobKeyword[];
  contact: string | null;
}

/**
 * Combines what used to be `detectJobLanguage` + `extractJobKeywords`, plus a contact lookup,
 * into a single MODEL_LUNA call — all three run automatically on every job load, over the same
 * `job` and the same applicant context, so splitting them into separate round trips only doubled
 * network/latency without any independent benefit. The contact lookup only costs anything when
 * `job.contact` came in null (DOM heuristics found nothing) — this is the one AI pass that always
 * runs regardless of how `job` was extracted, so it's the cheapest place to give AI a second shot
 * at a contact the DOM-only heuristic missed. The stable applicant-context fields are placed first
 * in the user prompt (ahead of the per-job `job` field) so that block stays a byte-identical
 * prefix across successive job analyses in the same session, which is what OpenAI's automatic
 * prompt caching keys off.
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
    keywords: filterJobKeywords(result.keywords, job),
    contact: result.contact,
  };
}
