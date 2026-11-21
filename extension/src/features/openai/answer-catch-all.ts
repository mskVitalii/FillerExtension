import type { Job } from "@/types/job";
import { getLocal } from "@/features/storage/local";
import { getApplicantContext } from "@/features/profile/context";
import { catchAllPlan, type CatchAllContext } from "@/features/autofill/catch-all";
import { MissingApiKeyError, requestStructured } from "./client";
import { DECISION_THRESHOLDS, predicateProbability, requestDecisions, type DecisionInput, type DecisionQuestion } from "./decisions";
import { applicantDecisionInput } from "./question-decisions";
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

const GATE = "catchAllAdds";

/** The system prompt's "write only when…" rules as one yes/no question, for the Decisions gate. */
function catchAllGateQuestion(postingAsk: string | undefined): DecisionQuestion {
  return {
    type: "predicate",
    name: GATE,
    instructions: `The application form has an open catch-all field ("field"), not marked required: "Additional information", "Anything else?".
The recruiter already has the applicant's CV, cover letter, profile and every value in "formValues"
and "otherAnswers". Should the applicant write anything in it?
- Yes only if ${postingAsk ? `the applicant's data covers what the posting explicitly asks applicants to include ("postingAsk") and the form doesn't already hold it, or if ` : ""}the applicant's data holds a genuinely NEW fact relevant to this application that appears nowhere else (e.g. a constraint the recruiter must know).
- No for anything already in the CV, cover letter, profile or form: contact data, links, salary, start date /
  notice period / availability, work permit / visa / relocation, language levels, a summary of the
  experience, the motivation.
- No when in doubt: an empty field is the normal, good outcome.`,
  };
}

/** P(the field should be written), or null when the Decisions call failed or didn't answer (then generate anyway). */
async function catchAllGate(
  shared: { input: DecisionInput; promptCacheKey: string },
  question: string,
  ctx: CatchAllContext,
  postingAsk: string | undefined,
): Promise<number | null> {
  try {
    // The per-field part goes last, so the applicant prefix stays shared with the form's other Decisions calls.
    const input: DecisionInput = [
      ...(shared.input as Exclude<DecisionInput, string>),
      {
        role: "user",
        content: [
          {
            type: "input_json",
            data: {
              formValues: (ctx.formValues ?? []).filter((v) => v.value.trim()),
              otherAnswers: (ctx.otherAnswers ?? []).filter((a) => a.answer.trim()),
              coverLetterAttached: ctx.coverLetterAttached || undefined,
              postingAsk: postingAsk ?? null,
              field: question,
            },
          },
        ],
      },
    ];
    const answers = await requestDecisions({ input, promptCacheKey: shared.promptCacheKey, questions: [catchAllGateQuestion(postingAsk)] });
    return predicateProbability(answers, GATE);
  } catch (err) {
    if (err instanceof MissingApiKeyError) throw err;
    console.warn("[Filler] Decisions API failed, writing the catch-all via Responses:", err);
    return null;
  }
}

/**
 * The answer for a catch-all field (`features/autofill/catch-all.ts`): empty for an optional one
 * the posting asks nothing specific for (no model call). A field that isn't required first passes
 * a cheap Decisions gate ("is there anything new to add?"), because the usual answer is to skip;
 * only above `DECISION_THRESHOLDS.catchAllWrite` (or if the gate fails) does one short model call
 * write it, given everything the form already holds so it can't repeat it — and it may still skip.
 */
export async function answerCatchAll(question: string, job: Job, ctx: CatchAllContext, postingLanguage?: string): Promise<CatchAllAnswer> {
  const plan = catchAllPlan(job, ctx);
  if (plan.action === "skip") return { answer: "", sufficientInfo: true, skipped: true };

  const [context, storedLetter] = await Promise.all([getApplicantContext(), getLocal("lastCoverLetter")]);
  if (ctx.required !== true) {
    const shared = applicantDecisionInput(context, storedLetter ?? "", job, postingLanguage);
    const probability = await catchAllGate(shared, question, ctx, plan.postingAsk);
    if (probability !== null && probability < DECISION_THRESHOLDS.catchAllWrite) return { answer: "", sufficientInfo: true, skipped: true };
  }

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
