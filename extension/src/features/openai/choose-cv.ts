import type { Job } from "@/types/job";
import type { CvMeta } from "@/types/profile";
import { languageName } from "@/lib/language-codes";
import { cvDisplayName, type CvChoice } from "@/features/cv-selection/select";
import { MissingApiKeyError, getSupportModel, requestStructured } from "./client";
import { DECISION_THRESHOLDS, choiceAnswer, requestDecisions } from "./decisions";

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
 * Settings → CVs → "Let AI choose": one Decisions `choice` over the library. Choices are
 * labelled `cv1`, `cv2`, … (the API works better with readable labels than with UUIDs), each
 * described by its name, language, default flag, rules and the start of its text. Below
 * `DECISION_THRESHOLDS.cvChoice` the caller keeps its offline pick. If the Decisions call
 * fails, the older structured Responses call decides instead.
 */
export async function chooseCvWithAi(job: Job, cvs: CvMeta[], postingLanguage?: string): Promise<CvChoice | null> {
  if (cvs.length < 2) return null;
  const labels = cvs.map((_, i) => `cv${i + 1}`);
  try {
    const answers = await requestDecisions({
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: "A job posting the applicant is applying to:" },
            {
              type: "input_json",
              data: {
                position: job.position,
                company: job.company,
                location: job.location,
                language: postingLanguage ?? null,
                techStack: job.techStack,
                description: job.description.slice(0, 4_000),
              },
            },
          ],
        },
      ],
      questions: [
        {
          type: "choice",
          name: "cv",
          instructions:
            "Which of the applicant's CVs should be sent to this posting? Prefer a CV written in the posting's language (else an English one), then the one whose rules fit the posting best, then the one marked default for that language.",
          choices: cvs.map((cv, i) => ({ value: labels[i], description: describeCv(cv) })),
        },
      ],
    });
    const answer = choiceAnswer(answers, "cv");
    const index = answer ? labels.indexOf(answer.choice) : -1;
    if (!answer || index < 0 || answer.confidence < DECISION_THRESHOLDS.cvChoice) return null;
    return { cvId: cvs[index].id, reason: "", source: "ai", confidence: answer.confidence };
  } catch (err) {
    if (err instanceof MissingApiKeyError) throw err;
    console.warn("[Filler] Decisions API failed, choosing the CV via Responses:", err);
    return chooseCvWithResponses(job, cvs, postingLanguage);
  }
}

function describeCv(cv: CvMeta): string {
  return [
    `Name: ${cvDisplayName(cv)}.`,
    `Language: ${cv.language ? languageName(cv.language) : "not set"}${cv.isDefaultForLanguage ? " (default CV for that language)" : ""}.`,
    cv.rules?.trim() ? `Applicant's rules for it: ${cv.rules.trim()}` : "",
    `Starts: ${cv.text.slice(0, 600).replace(/\s+/g, " ")}`,
  ]
    .filter(Boolean)
    .join(" ");
}

async function chooseCvWithResponses(job: Job, cvs: CvMeta[], postingLanguage?: string): Promise<CvChoice | null> {
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
