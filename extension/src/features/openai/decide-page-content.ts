import type { Job } from "@/types/job";
import type { CustomQuestion } from "@/features/autofill/custom-questions";
import { isNewsletterLike, type PageCheckbox } from "@/features/autofill/checkboxes";
import { getLocal } from "@/features/storage/local";
import { getApplicantContext } from "@/features/profile/context";
import { DATE_FORMAT_EXAMPLE, todayISO } from "@/lib/date-format";
import { requestStructured } from "./client";
import { HOUSE_STYLE_RULES, stripEmDashes } from "./house-style";
import { isNonAnswer } from "./answer-question";
import type { CheckboxCategory, CheckboxDecision } from "./decide-checkboxes";

export type { CheckboxDecision } from "./decide-checkboxes";

export interface PageContentQuestionAnswer {
  id: string;
  answer: string;
  sufficientInfo: boolean;
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["checkboxDecisions", "questionAnswers"],
  properties: {
    checkboxDecisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "check", "category", "reason"],
        properties: {
          index: { type: "integer" },
          check: { type: "boolean" },
          category: { type: "string", enum: ["required-consent", "marketing", "optional", "unclear"] },
          reason: { type: "string" },
        },
      },
    },
    questionAnswers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "answer", "sufficientInfo"],
        properties: {
          id: { type: "string" },
          answer: { type: "string" },
          sufficientInfo: { type: "boolean" },
        },
      },
    },
  },
} as const;

const SYSTEM_PROMPT = `You fill in two independent things found on a job-application form at once:
consent checkboxes to decide, and custom questions to answer on the applicant's behalf. The
applicant has already chosen to submit this application.

CHECKBOXES (one decision per item in "checkboxes", matched back by "index")

TICK (check: true) — things required to submit, or that a candidate is normally expected to
accept:
- privacy policy / data protection / GDPR / Datenschutz consent
- terms & conditions / AGB / Nutzungsbedingungen
- confirming the entered information is accurate / truthful
- consent to process and store the application data for THIS hiring process
- storing the data in a talent pool ONLY when the checkbox is marked required
- eligibility self-declarations that hold for any ordinary adult applying for a real job (e.g.
  "I am at least 18 years old", "I am legally entitled to work in [country]", "I have no
  undisclosed conflicts of interest") — assume true unless the profile/CV explicitly states
  otherwise; a genuine job applicant submitting this form is virtually always eligible, and
  leaving a required declaration like this unticked blocks submission for no real reason

DO NOT TICK (check: false) — optional and promotional:
- newsletters, marketing e-mails, "career news", event invitations
- job alerts / notifications about new postings (e.g. "Benachrichtigungen über neue
  Stellenausschreibungen erhalten")
- sharing data with third parties / partner companies for marketing
- joining a talent pool / candidate database when NOT required
- anything that benefits the applicant only beyond this one application

Rules:
- "required: true" means the form marks the field mandatory — a strong signal to tick, unless
  the text is clearly marketing.
- A newsletter/marketing-email/job-alert opt-in is NEVER ticked, even when the form marks it
  "required" — that flag is routinely misused by forms to guilt-trip applicants into
  subscribing, even though applicants never actually need it to submit. When genuinely in doubt
  whether a required checkbox is a real submission requirement or a disguised newsletter
  opt-in, prefer NOT ticking it.
- If a checkbox is ambiguous AND not required, set check: false.
- Labels may be in any language; judge by meaning, not keywords.
- category: "required-consent" (ticked, mandatory-type), "marketing" (left off), "optional"
  (non-marketing but skippable, left off unless required), "unclear" (left off). reason: one
  short phrase.
- Return one decision per input item in "checkboxes", using its "index". If "checkboxes" is
  empty, return an empty array.

QUESTIONS (one answer per item in "questions", matched back by "id")

Ground rules:
- Use ONLY facts present in the shared "profile"/"cvText"/"personalLegend"/"generationRules"/
  "coverLetter"/"languageLevels"/"customFields"/"faq" given below, plus "job". Never invent
  experience, technologies, companies, education, or achievements.
- For any question about the applicant's proficiency in a language, "languageLevels" is the
  authoritative answer (CEFR levels the applicant self-reported in Settings) — use it directly
  rather than guessing from the CV or defaulting to a low/neutral level.
- If the shared material genuinely lacks what's needed to answer a given question — not just a
  minor detail, but the actual substance being asked for — set that item's "sufficientInfo" to
  false and "answer" to an empty string. Do NOT write a sentence explaining that you don't have
  the information — that text would otherwise get typed straight into the applicant's form
  field, which is worse than leaving it blank. Only do this when the information is truly
  absent; a question you can answer honestly with what IS available (e.g. "I don't have direct
  experience with X, but I've worked with Y") still counts as sufficient.
- If "postingLanguage" is given, write answers in that language, using the salutation/register
  conventions native speakers of it would expect on a job application (e.g. formal
  "Sie"/"Herr"/"Frau" address in German) — unless the question itself, or "generationRules",
  explicitly asks for a different language.
- A newsletter/marketing-email/job-alert subscription opt-in phrased as a question (e.g. "Would
  you like to subscribe to our newsletter? Yes/No") always gets the option that declines it.
- "faq" is a set of pre-written answers to standard interview-FAQ questions. If a question being
  asked now is the same as, or a close variant of, one already in "faq", reuse its substance and
  phrasing — adapt only what the target field's length/format actually requires.
- Match each question's expected length: a short field gets a short answer, an open-ended
  "tell us about..." field gets a fuller one.
- Output plain text per answer, no markdown, no restating the question.
- Each item in "questions" may also carry:
  - "options" (and not "multi"): a single-choice question — reply with EXACTLY ONE option,
    copied verbatim, nothing else. If the needed fact is genuinely absent (e.g. pronouns not
    stated anywhere), prefer a neutral option or an explicit "prefer not to say".
  - "options" with "multi": true: a select-all-that-apply question — reply with every option
    that genuinely applies, each copied verbatim, joined by " | " (one pipe, one space each
    side). If none apply, reply with an empty string. Never include an option just because it's
    plausible — only ones the applicant's own material actually supports.
  - "numeric": true: the field only accepts a plain number — reply with digits only (a single
    "." for a decimal if needed), no currency symbol, no thousands separator, no unit, no words,
    no range. If a range genuinely fits best (e.g. "65-75k"), reply with one representative
    figure (its midpoint).
  - "dateFormat": the field only accepts a date in exactly that format — reply with ONLY that
    value, nothing else. "todayISO" below is today's date: compute the answer from it — e.g.
    "available with one month's notice" -> todayISO plus one month; "immediately"/"as soon as
    possible"/no stated constraint -> todayISO itself.
- Return one answer per input item in "questions", using its "id". If "questions" is empty,
  return an empty array.

${HOUSE_STYLE_RULES}`;

interface RawCheckboxDecision {
  index: number;
  check: boolean;
  category: CheckboxCategory;
  reason: string;
}

interface RawQuestionAnswer {
  id: string;
  answer: string;
  sufficientInfo: boolean;
}

function applyCheckboxDecisions(checkboxes: PageCheckbox[], raw: RawCheckboxDecision[]): CheckboxDecision[] {
  const byIndex = new Map<number, RawCheckboxDecision>();
  for (const decision of raw) byIndex.set(decision.index, decision);

  return checkboxes.map((checkbox, index) => {
    const decision = byIndex.get(index);
    if (decision) {
      // Belt-and-suspenders on top of the prompt rule above: a newsletter
      // opt-in is never ticked, even on the rare occasion the model gets it
      // wrong (spec_8 item 5 — this one must never regress).
      const check = decision.check && isNewsletterLike(checkbox.label) ? false : decision.check;
      return { name: checkbox.name, label: checkbox.label, check, category: decision.category, reason: decision.reason };
    }
    if (isNewsletterLike(checkbox.label)) {
      return { name: checkbox.name, label: checkbox.label, check: false, category: "marketing", reason: "No decision returned — looks like a newsletter/marketing opt-in" };
    }
    return {
      name: checkbox.name,
      label: checkbox.label,
      check: checkbox.required,
      category: checkbox.required ? "required-consent" : "unclear",
      reason: checkbox.required ? "Marked required by the form" : "No decision returned",
    };
  });
}

function applyQuestionAnswers(questions: CustomQuestion[], raw: RawQuestionAnswer[]): PageContentQuestionAnswer[] {
  const byId = new Map<string, RawQuestionAnswer>();
  for (const answer of raw) byId.set(answer.id, answer);

  return questions.map((q) => {
    const found = byId.get(q.id);
    if (!found) return { id: q.id, answer: "", sufficientInfo: true };
    if (!found.sufficientInfo || isNonAnswer(found.answer)) {
      return { id: q.id, answer: "", sufficientInfo: found.sufficientInfo };
    }
    const constrained = (q.options && q.options.length > 0) || q.numeric || Boolean(q.dateKind);
    return { id: q.id, answer: constrained ? found.answer : stripEmDashes(found.answer), sufficientInfo: true };
  });
}

/**
 * Replaces what used to be a standalone checkbox-decision call plus one parallel
 * `answerCustomQuestion` call per detected question — both fire automatically the moment the
 * Side Panel opens on a posting. They already ran concurrently, so this doesn't shorten the critical path much when only one
 * question is pending — the real win is fewer simultaneous requests against the user's own
 * OpenAI rate limit when a form has several questions, and sending the shared applicant
 * context/job/cover-letter once instead of once per question. A later single question (manual
 * add, picker) still goes through `answerCustomQuestion` on its own rather than round-tripping
 * through this batch machinery for one item.
 */
export async function decidePageContent(
  checkboxes: PageCheckbox[],
  questions: CustomQuestion[],
  job: Job,
  postingLanguage?: string,
): Promise<{ checkboxDecisions: CheckboxDecision[]; questionAnswers: PageContentQuestionAnswer[] }> {
  if (checkboxes.length === 0 && questions.length === 0) return { checkboxDecisions: [], questionAnswers: [] };

  const [context, coverLetter] = await Promise.all([getApplicantContext(), getLocal("lastCoverLetter")]);

  const userPrompt = JSON.stringify(
    {
      job,
      profile: context.profile,
      cvText: context.cvText,
      personalLegend: context.personalLegend,
      generationRules: context.generationRules,
      coverLetter: coverLetter ?? "",
      languageLevels: context.languageLevels,
      customFields: context.customFields,
      faq: context.faq.filter((f) => f.answer.trim()),
      todayISO: todayISO(),
      postingLanguage: postingLanguage || undefined,
      checkboxes: checkboxes.map((checkbox, index) => ({
        index,
        label: checkbox.label,
        required: checkbox.required,
        currentlyChecked: checkbox.checked,
      })),
      questions: questions.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options && q.options.length > 0 ? q.options : undefined,
        multi: q.multi,
        numeric: q.numeric,
        dateFormat: q.dateKind ? DATE_FORMAT_EXAMPLE[q.dateKind] : undefined,
      })),
    },
    null,
    2,
  );

  const result = await requestStructured<{ checkboxDecisions: RawCheckboxDecision[]; questionAnswers: RawQuestionAnswer[] }>({
    schemaName: "page_content_decisions",
    schema: SCHEMA,
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { checkboxDecisions: RawCheckboxDecision[]; questionAnswers: RawQuestionAnswer[] },
  });

  return {
    checkboxDecisions: applyCheckboxDecisions(checkboxes, result.checkboxDecisions),
    questionAnswers: applyQuestionAnswers(questions, result.questionAnswers),
  };
}
