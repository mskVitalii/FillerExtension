import type { Job, JobBrief, JobKeyword, JobLanguageInfo } from "@/types/job";
import { CEFR_LEVELS } from "@/lib/language-level";
import { getApplicantContext } from "@/features/profile/context";
import { getExtractionModel, requestStructured } from "@/features/openai/client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "company",
    "position",
    "location",
    "description",
    "requirements",
    "responsibilities",
    "salary",
    "techStack",
    "contact",
    "postingLanguages",
    "languageRequirements",
    "keywords",
  ],
  properties: {
    company: { type: "string" },
    position: { type: "string" },
    location: { type: "string" },
    description: { type: "string" },
    requirements: { type: "array", items: { type: "string" } },
    responsibilities: { type: "array", items: { type: "string" } },
    salary: { type: ["string", "null"] },
    techStack: { type: "array", items: { type: "string" } },
    contact: { type: ["string", "null"] },
    postingLanguages: { type: "array", items: { type: "string" } },
    languageRequirements: {
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

const SYSTEM_PROMPT = `You read the visible text of a job-posting page and do two things with it
in one pass: extract the structured posting fields, and analyze the result for language and
keywords — against the applicant profile/CV/Personal Legend given below.

EXTRACTION
- Only use information present in "pageText"; leave a field empty/null if unknown.
- For "contact", prefer a named recruiter/hiring manager's email address or LinkedIn
  profile/company URL if one is mentioned, copied VERBATIM (exact characters); otherwise null.

LANGUAGE
- postingLanguages: the language(s) the posting text itself is written in (e.g. "English").
- languageRequirements: any language the posting explicitly asks the applicant to know or be
  proficient in, with a level. Map loose phrasing to the nearest CEFR level (A1-C2, or "Native"
  for "native speaker"/"muttersprachlich") when you reasonably can — e.g. "fluent", "professional
  working proficiency" -> "C1"; "conversational" -> "B1". If a language is mentioned but no level
  can be reasonably inferred, set level to null. Do not invent a requirement that isn't stated in
  the text. If nothing is stated, return an empty array.

KEYWORDS
- Pick the notable keywords/key phrases out of the posting — the skills, tools, technologies,
  qualifications, and requirements a candidate would want to notice at a glance.
- Every keyword's "text" MUST be copied VERBATIM from "pageText" — the exact same characters and
  casing, not a paraphrase, synonym, or translation — because the extension re-finds this exact
  text on the page to highlight it. A keyword that doesn't appear verbatim in the text is useless.
- Prefer short phrases: single words or 2-3 word phrases (e.g. "TypeScript", "Kubernetes",
  "5+ years", "product management", "Bachelor's degree") — not full sentences.
- Pick 8-15 of the most important ones. Skip generic filler ("team player", "fast-paced
  environment") unless the posting has almost nothing more specific.
- No duplicates, and no two keywords where one is a substring of the other (keep the more
  specific/longer one).
- Set "matchesProfile" to true when the applicant's profile/cvText/personalLegend shows they
  already have, use, or meet that skill/tool/technology/qualification — false when the posting
  asks for it but nothing in the applicant's material supports it. Judge substance, not exact
  wording (e.g. "Kubernetes" counts as a match if the CV mentions "container orchestration with
  K8s" or "EKS"). When genuinely unsure, set it to false — this flags a possible gap for the
  applicant to address rather than silently hiding it.`;

interface RawResult {
  company: string;
  position: string;
  location: string;
  description: string;
  requirements: string[];
  responsibilities: string[];
  salary: string | null;
  techStack: string[];
  contact: string | null;
  postingLanguages: string[];
  languageRequirements: JobLanguageInfo["requirements"];
  keywords: JobKeyword[];
}

/**
 * Only called when DOM/JSON-LD extraction is insufficient (spec section 10), or for a job pasted
 * in as raw text, which has no DOM pass to begin with. Sends visible text — never the raw page
 * HTML — to the user's OpenAI key.
 *
 * Folds the brief analysis (language + keywords, normally `analyze-job-brief.ts`'s job) into the
 * same call instead of a second round trip right after: extraction already has to read the full
 * posting text once, and the applicant context needed to judge keywords/language is the same
 * context this call already needs for nothing else — splitting it back into two requests would
 * just pay for that same context twice. The DOM-sufficient path (the common case) is untouched
 * and still costs exactly one call (`analyzeJobBrief` alone).
 */
export async function extractJobWithAiAndBrief(
  visibleText: string,
  url: string,
): Promise<{ job: Job; brief: JobBrief }> {
  const context = await getApplicantContext();

  const userPrompt = JSON.stringify(
    {
      profile: context.profile,
      cvText: context.cvText,
      personalLegend: context.personalLegend,
      pageText: visibleText.slice(0, 12000),
    },
    null,
    2,
  );

  const result = await requestStructured<RawResult>({
    schemaName: "job_extraction_and_brief",
    schema: SCHEMA,
    model: await getExtractionModel(),
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as RawResult,
  });

  const job: Job = {
    company: result.company,
    position: result.position,
    location: result.location,
    description: result.description,
    requirements: result.requirements,
    responsibilities: result.responsibilities,
    salary: result.salary,
    techStack: result.techStack,
    contact: result.contact,
    url,
  };
  const brief: JobBrief = {
    language: { postingLanguages: result.postingLanguages, requirements: result.languageRequirements },
    keywords: result.keywords,
    // The extraction above already had its one shot at `contact` — nothing further to add.
    contact: null,
  };
  return { job, brief };
}
