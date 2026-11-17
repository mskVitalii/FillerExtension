import type { Job } from "@/types/job";
import type { CvMeta } from "@/types/profile";
import { languageName } from "@/lib/language-codes";
import { cvDisplayName, type CvChoice } from "@/features/cv-selection/select";
import { getSupportModel, requestStructured } from "./client";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["cvId", "reason"],
  properties: {
    cvId: { type: "string" },
    reason: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You pick which of an applicant's CVs to send to one job posting.
Each CV has an id, a name, the language it's written in, the applicant's own rules for which
postings it's for, and the start of its text.
- Prefer a CV written in the posting's language; if none, an English one.
- Then follow the applicant's rules: the CV whose rules fit this posting best.
- Then the one marked default for that language.
Return the chosen CV's exact "id" and a reason of at most 10 words. Plain text, no em dashes.`;

/**
 * Lets the support-model tier choose the CV (Settings → CVs → "Let AI choose"):
 * one small structured call with the posting and every CV's description.
 * An id that isn't in the library is rejected, so the caller keeps the
 * offline pick.
 */
export async function chooseCvWithAi(job: Job, cvs: CvMeta[], postingLanguage?: string): Promise<CvChoice | null> {
  if (cvs.length < 2) return null;
  const payload = {
    posting: {
      position: job.position,
      company: job.company,
      location: job.location,
      language: postingLanguage ?? null,
      techStack: job.techStack,
      description: job.description.slice(0, 4_000),
    },
    cvs: cvs.map((cv) => ({
      id: cv.id,
      name: cvDisplayName(cv),
      language: cv.language ? languageName(cv.language) : null,
      defaultForLanguage: Boolean(cv.isDefaultForLanguage),
      rules: cv.rules ?? "",
      textStart: cv.text.slice(0, 1_200),
    })),
  };
  const result = await requestStructured<{ cvId: string; reason: string }>({
    schemaName: "cv_choice",
    schema: SCHEMA,
    model: await getSupportModel(),
    reasoningEffort: "low",
    systemPrompt: SYSTEM_PROMPT,
    userPrompt: JSON.stringify(payload, null, 2),
    parse: (raw) => JSON.parse(raw) as { cvId: string; reason: string },
  });
  if (!cvs.some((cv) => cv.id === result.cvId)) return null;
  return { cvId: result.cvId, reason: result.reason.replace(/—/g, ",").trim() || "AI pick", source: "ai" };
}
