import type { Job } from "@/types/job";
import { getLocal } from "@/features/storage/local";
import { getApplicantContext } from "@/features/profile/context";
import { catchAllPlan, type CatchAllContext } from "@/features/autofill/catch-all";
import { requestStructured } from "./client";
import { HOUSE_STYLE_RULES, stripEmDashes } from "./house-style";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["skip", "answer"],
  properties: {
    skip: { type: "boolean" },
    answer: { type: "string" },
  },
} as const;

const SYSTEM_PROMPT = `You decide what, if anything, goes into the open catch-all field at the end of a
job application form ("Additional information", "Anything else you'd like to share?", "Weitere
Informationen", "Sonstiges", "Message to the hiring team"). The recruiter already has everything
in "formValues", "otherAnswers", the attached CV ("cvText"), the cover letter ("coverLetter") and
the profile. Repeating any of it wastes their time and makes the application look padded.

Rules:
- "skip": true, "answer": "" is the normal result. Choose it whenever there is nothing NEW and
  relevant to add. An empty field is fine.
- Never repeat or paraphrase: contact data (name, email, phone, address, city), links (LinkedIn,
  GitHub, portfolio, website), salary expectations, start date / notice period / availability,
  work permit / visa / relocation, language levels, a summary of the CV or the experience, or the
  motivation already given in the cover letter or other answers.
- "postingAsk" (when present) is what the job posting explicitly asks applicants to include.
  Answer exactly that, from the applicant's data, if it isn't already in the form. If the data
  doesn't have it, skip.
- "required": true means the form won't submit with the field empty. Then don't skip: write ONE
  short sentence with something new from the Personal Legend or custom fields, or, if there is
  truly nothing new, one plain neutral sentence (e.g. that you look forward to hearing from them).
- Otherwise ("required" false or unknown), write only when there is a genuinely new, relevant fact
  (e.g. a constraint the recruiter must know that appears nowhere else).
- At most 2 sentences, plain text, no greeting, no sign-off, no lists, no markdown.
- Never invent facts. Use ONLY the applicant data given.
- If "postingLanguage" is given, write in that language with its native application register.

${HOUSE_STYLE_RULES}`;

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b[\w.-]+\.(?:com|de|io|dev|net|org|me)\/\S*/i;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;
const PHONE_RE = /(?:\+|\b00)\d[\d\s/().-]{6,}\d|\b0\d{2,4}[\s/-]?\d{3,}[\s-]?\d{2,}\b/;

/** At most two sentences, minus any that carry a link, an email or a phone number. */
export function trimCatchAllAnswer(text: string): string {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=\S)/u)
    .filter((s) => s && !URL_RE.test(s) && !EMAIL_RE.test(s) && !PHONE_RE.test(s));
  return sentences.slice(0, 2).join(" ").trim();
}

export interface CatchAllAnswer {
  answer: string;
  /** False only when a required catch-all came back empty: the user must fill it. */
  sufficientInfo: boolean;
  /** True when the field is deliberately left empty. */
  skipped: boolean;
}

/**
 * The answer for a catch-all field (`features/autofill/catch-all.ts`): empty for an optional one
 * the posting asks nothing specific for (no model call), otherwise one short model call that may
 * still return `skip`, given everything the form already holds so it can't repeat it.
 */
export async function answerCatchAll(question: string, job: Job, ctx: CatchAllContext, postingLanguage?: string): Promise<CatchAllAnswer> {
  const plan = catchAllPlan(job, ctx);
  if (plan.action === "skip") return { answer: "", sufficientInfo: true, skipped: true };

  const [context, storedLetter] = await Promise.all([getApplicantContext(), getLocal("lastCoverLetter")]);
  const userPrompt = JSON.stringify(
    {
      job,
      profile: context.profile,
      cvText: context.cvText,
      coverLetter: storedLetter ?? "",
      coverLetterAttached: ctx.coverLetterAttached || undefined,
      personalLegend: context.personalLegend,
      customFields: context.customFields,
      languageLevels: context.languageLevels,
      generationRules: context.generationRules,
      postingLanguage: postingLanguage || undefined,
      formValues: (ctx.formValues ?? []).filter((v) => v.value.trim()),
      otherAnswers: (ctx.otherAnswers ?? []).filter((a) => a.answer.trim()),
      postingAsk: plan.postingAsk,
      required: ctx.required ?? "unknown",
      question,
    },
    null,
    2,
  );

  const result = await requestStructured<{ skip: boolean; answer: string }>({
    schemaName: "catch_all_answer",
    schema: SCHEMA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    label: "Catch-all answer",
    parse: (raw) => JSON.parse(raw) as { skip: boolean; answer: string },
  });

  const answer = result.skip ? "" : trimCatchAllAnswer(stripEmDashes(result.answer));
  if (!answer) return { answer: "", sufficientInfo: ctx.required !== true, skipped: true };
  return { answer, sufficientInfo: true, skipped: false };
}
