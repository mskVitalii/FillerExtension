import type { Job } from "@/types/job";
import { getLocal } from "@/features/storage/local";
import { getApplicantContext } from "@/features/profile/context";
import { DATE_FORMAT_EXAMPLE, todayISO, type DateInputKind } from "@/lib/date-format";
import { requestStructured } from "./client";
import { HOUSE_STYLE_RULES, stripEmDashes } from "./house-style";

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "sufficientInfo"],
  properties: {
    answer: { type: "string" },
    sufficientInfo: { type: "boolean" },
  },
} as const;

const SYSTEM_PROMPT = `You answer a custom question from a job application form on the
applicant's behalf.

Ground rules:
- Use ONLY facts present in the provided profile, CV text, Personal Legend,
  cover letter, custom fields, language levels, and job posting. Never invent
  experience, technologies, companies, education, or achievements.
- For any question about the applicant's proficiency in a language, the
  "languageLevels" list is the authoritative answer (CEFR levels the
  applicant self-reported in Settings) — use it directly rather than
  guessing from the CV or defaulting to a low/neutral level.
- If the profile/CV/Personal Legend/etc genuinely lack what's needed to
  answer this question — not just a minor detail, but the actual substance
  being asked for — set "sufficientInfo" to false and "answer" to an empty
  string. Do NOT write a sentence explaining that you don't have the
  information (e.g. "I don't have this information available") — that text
  would otherwise get typed straight into the applicant's form field, which
  is worse than leaving it blank for the applicant to fill in themselves.
  Only do this when the information is truly absent; a question you can
  answer honestly with what IS available (e.g. "I don't have direct
  experience with X, but I've worked with Y") still counts as sufficient —
  set sufficientInfo to true and give that honest answer.
- If "postingLanguage" is given, write the answer in that language, using
  the salutation/register conventions native speakers of it would expect on
  a job application (e.g. formal "Sie"/"Herr"/"Frau" address in German, not
  a literal English-to-German translation) — unless the question itself, or
  "generationRules", explicitly asks for a different language.
- If this question is a newsletter, marketing-email, or job-alert
  subscription opt-in phrased as a choice (e.g. "Would you like to
  subscribe to our newsletter? Yes/No"), always choose the option that
  declines it — the applicant never needs this to submit the application.
- "faq" is a set of pre-written answers to standard interview-FAQ questions
  (spec_5 section B). If the question being asked now is the same as, or a
  close variant of, one already in "faq", reuse its substance and phrasing —
  adapt only what the target field's length/format actually requires — so
  the applicant's answer stays consistent across different forms rather
  than being re-derived from scratch each time.
- Match the question's expected length: a short field gets a short answer, an
  open-ended "tell us about..." field gets a fuller one.
- If "generationRules" contains applicant-specified instructions for how
  their text should be written (tone, things to include/avoid), follow them
  as long as they don't conflict with the Ground rules above.
- Output plain text, no markdown, no restating the question.

${HOUSE_STYLE_RULES}`;

/**
 * A defensive backstop, independent of how good the question-detection
 * signal sent in was: the model can still come back with a "please provide
 * the actual question" refusal instead of an answer (a garbled or
 * ambiguous `question` slipped through). Writing that refusal into the
 * applicant's form field is worse than leaving it blank — the Side Panel
 * already shows a clear "No answer yet" state for a question with no
 * answer, so treating this as one keeps a field the extension genuinely
 * can't answer visibly blank instead of silently filling in nonsense.
 * Deliberately narrow — requires *both* a refusal-shaped lead-in *and* the
 * model explicitly talking about "the question"/"the prompt" itself nearby
 * — so a legitimate, honest "I don't have direct experience with X, but…"
 * answer (which the system prompt explicitly asks for when real profile
 * data is missing) is never mistaken for this.
 */
const NON_ANSWER_RE =
  /\b(?:please\s+(?:provide|specify|clarify)|could\s+you\s+(?:please\s+)?(?:provide|clarify|specify)|i\s+(?:don'?t|do\s+not)\s+see)\b.{0,40}?\b(?:question|prompt)\b|\bno\s+(?:specific\s+)?question\s+(?:was|is)?\s*(?:provided|given|specified|attached)\b/i;

export function isNonAnswer(answer: string): boolean {
  const trimmed = answer.trim();
  if (!trimmed) return true;
  return trimmed.length < 220 && NON_ANSWER_RE.test(trimmed);
}

const CHOICE_RULE = `
- This is a MULTIPLE-CHOICE question: "options" lists the allowed answers.
  Reply with EXACTLY ONE option, copied verbatim, and nothing else.
- Base the choice on the applicant's profile/CV/Personal Legend. If the
  needed fact is genuinely absent (e.g. pronouns not stated anywhere),
  prefer a neutral option, an explicit "prefer not to say", or the option
  that commits the applicant least.`;

/** A "select all that apply" checkbox group (e.g. "which of these technologies…") — a `CHOICE_RULE` variant allowing more than one option back. */
const MULTI_CHOICE_RULE = `
- This is a SELECT-ALL-THAT-APPLY question: "options" lists every allowed
  answer. Reply with every option that genuinely applies, each copied
  verbatim, joined by " | " (a single pipe surrounded by one space on each
  side) — nothing else. If none apply, reply with an empty string.
- Base each choice strictly on the applicant's profile/CV/Personal Legend —
  never include an option just because it's plausible or common; only ones
  the applicant's own material actually supports.`;

/**
 * The target field is `<input type="number">` (or an equivalent
 * numeric-only field) — a prose answer like "around 65,000 EUR" or a range
 * like "65000-75000" gets silently rejected by the browser (the HTML
 * value-sanitization algorithm resets a non-numeric value to "") or picks
 * the wrong end of the range when parsed back out. Ask for the single bare
 * number the applicant would actually type into that box.
 */
const NUMERIC_RULE = `
- This field only accepts a plain number: reply with digits only (a single
  "." for a decimal if needed) — no currency symbol, no thousands
  separator, no unit, no words, no range. If a range genuinely fits best
  (e.g. a salary expectation given as "65-75k"), reply with one
  representative figure (its midpoint), not the range.`;

/**
 * The target field is `<input type="date">` (or its month/week/time/
 * datetime-local siblings) — the browser applies the same hard,
 * silent-reset-to-empty validation as `type="number"`, just against a
 * stricter exact format. A question like "earliest possible start date"
 * naturally invites an answer about a *notice period* ("with one month's
 * notice") rather than a calendar date — confirmed live on Stepstone,
 * where exactly that left a required date field empty. `todayISO` in the
 * user prompt is the reference point for computing the actual date.
 */
function dateRule(kind: DateInputKind): string {
  return `
- This field only accepts a date in the exact format "${DATE_FORMAT_EXAMPLE[kind]}"
  — reply with ONLY that value, nothing else (no words, no explanation).
  "todayISO" in the data below is today's date: compute the answer from it
  — e.g. "available with one month's notice" → todayISO plus one month;
  "immediately" / "as soon as possible" / no stated constraint → todayISO
  itself. Never answer with a description of the notice period or
  availability instead of the date itself.`;
}

/**
 * Custom application questions (spec_2 item 5) — grounded in the same
 * sources the cover-letter pipeline uses (features/cover-letter/pipeline.ts),
 * plus the current cover letter draft itself so the answer stays consistent
 * with what the applicant already submitted. Runs on the support tier: these
 * are mostly short, factual form fields (previous employer, notice period,
 * referral name), answered automatically for every detected question the
 * moment the Side Panel opens on a posting — latency and cost per open
 * matter more here than the extra nuance the cover-letter tier would add.
 */
export interface CustomQuestionAnswer {
  answer: string;
  /** False when the model reports the profile/CV/etc genuinely lack what this question asks for — the caller should show that as a distinct "not enough info" state rather than a plain empty answer (spec_8 item 6). */
  sufficientInfo: boolean;
}

export async function answerCustomQuestion(
  question: string,
  job: Job,
  options?: string[],
  numeric?: boolean,
  dateKind?: DateInputKind,
  multi?: boolean,
  postingLanguage?: string,
): Promise<CustomQuestionAnswer> {
  const [context, coverLetter] = await Promise.all([getApplicantContext(), getLocal("lastCoverLetter")]);

  // Field order matters for more than readability: everything through "faq" below is
  // byte-identical across every question answered for this job in the same panel-open burst
  // (`answerAndFillQuestions` fires one call per question, all in parallel) — putting that
  // shared block first and the actually-per-question fields ("question"/"options") last keeps
  // it a stable prefix, which is what OpenAI's automatic prompt caching matches against.
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
      question,
      options: options && options.length > 0 ? options : undefined,
    },
    null,
    2,
  );

  const rules = [
    options && options.length > 0 ? (multi ? MULTI_CHOICE_RULE : CHOICE_RULE) : "",
    numeric ? NUMERIC_RULE : "",
    dateKind ? dateRule(dateKind) : "",
  ].filter(Boolean);

  const result = await requestStructured<{ answer: string; sufficientInfo: boolean }>({
    schemaName: "custom_question_answer",
    schema: SCHEMA,
    systemPrompt: rules.length > 0 ? [SYSTEM_PROMPT, ...rules].join("\n") : SYSTEM_PROMPT,
    userPrompt,
    parse: (raw) => JSON.parse(raw) as { answer: string; sufficientInfo: boolean },
  });

  if (!result.sufficientInfo || isNonAnswer(result.answer)) {
    return { answer: "", sufficientInfo: result.sufficientInfo };
  }
  // Constrained answers (a verbatim option, a bare number, an exact date) must
  // pass through untouched — only free-text prose gets the em-dash sweep.
  const constrained = (options && options.length > 0) || numeric || Boolean(dateKind);
  return { answer: constrained ? result.answer : stripEmDashes(result.answer), sufficientInfo: true };
}
