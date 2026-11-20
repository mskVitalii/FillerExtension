import type { Job } from "@/types/job";

/**
 * Catch-all fields: the free-text box at the end of an application form that asks for nothing in
 * particular ("Additional information", "Anything else you'd like to share?", "Weitere
 * Informationen", "Sonstiges", "Message to the hiring team"). Answering them like a real question
 * filled them with what the applicant had already given elsewhere (contact data, salary, start
 * date, a CV summary). By default an optional one stays empty; see `catchAllPlan`.
 *
 * Pure text functions, shared by the content script (detection), the background (answering) and
 * Filler Agent's form agent.
 */

/** Phrases that are a catch-all wherever they appear on the form. */
const STRONG_RE = new RegExp(
  [
    // English
    String.raw`(?:additional|further|other|more|extra|supplementary)\s+(?:information|info|details|comments?|remarks?|notes?|thoughts)`,
    String.raw`anything\s+else`,
    String.raw`is\s+there\s+anything(?:\s+else)?`,
    String.raw`any(?:thing)?\s+(?:other|further|additional|final)\s+(?:comments?|remarks?|notes?|information|thoughts)`,
    String.raw`(?:any|final)\s+(?:comments?|remarks?|notes?|thoughts)`,
    String.raw`(?:a\s+)?(?:message|note)\s+(?:to|for)\s+(?:the\s+|our\s+)?(?:hiring\s+(?:team|manager)|recruit(?:er|ing\s+team|ment\s+team)|team|us|company|employer)`,
    // German
    String.raw`(?:weitere|zus[aä]tzliche|sonstige|erg[aä]nzende|andere)\s+(?:informationen|infos?|angaben|anmerkungen|hinweise|bemerkungen|mitteilungen|kommentare)`,
    String.raw`sonstiges`,
    String.raw`(?:m[oö]chten|willst|m[oö]chtest)\s+(?:sie|du)\s+uns\s+(?:sonst\s+)?noch\s+(?:etwas|was)`,
    String.raw`gibt\s+es\s+(?:sonst\s+)?noch\s+(?:etwas|was)`,
    String.raw`(?:nachricht|mitteilung)\s+an\s+(?:uns|das\s+team|den\s+recruiter|die\s+personalabteilung)`,
    // French / Spanish / Russian
    String.raw`informations?\s+compl[ée]mentaires?`,
    String.raw`informaci[oó]n\s+adicional`,
    String.raw`дополнительн(?:ая|ые)\s+(?:информация|сведения|комментари[йи])`,
  ].join("|"),
  "iu",
);

/** One-word labels that are a catch-all only as the last free-text field of the form. */
const WEAK_RE =
  /^(?:your\s+|ihre?\s+|deine?\s+|persönliche\s+)?(?:messages?|comments?|remarks?|notes?|nachricht|anmerkungen?|bemerkungen?|kommentare?|hinweise?|mitteilung|commentaires?|comentarios?|комментари[йи]|сообщение)$/iu;

/** A cover-letter text box: a catch-all only when the letter is already attached as a file. */
const COVER_LETTER_RE = /^(?:your\s+|ihr\s+)?(?:cover\s+letter|motivation(?:al)?\s+letter|anschreiben|motivationsschreiben|lettre\s+de\s+motivation|carta\s+de\s+presentaci[oó]n|сопроводительное\s+письмо)$/iu;

/** Words that only pad a catch-all label: nothing the applicant is actually being asked for. */
const FILLER_RE = new RegExp(
  String.raw`\b(?:optional|freiwillig|facultatif|opcional|необязательно|please|bitte|here|hier|you|you'?d|would|like|to|share|add|tell|let|us|know|mention|with|about|yourself|we|should|that|the|a|an|and|or|for|me|your|our|any|on|in|of|this|application|role|position|job|team|hiring|sie|du|uns|noch|etwas|was|mitteilen|teilen|sagen|zu|ihrer|ihre|deiner|bewerbung|stelle|möchten|möchtest|gibt|es|sonst|und|oder|für|die|der|das|den|dem|an|mit|über|is|there|else|do|have|want|wish|feel|free|e\.?\s?g\.?|z\.?\s?b\.?)\b`,
  "giu",
);

export type CatchAllKind = "strong" | "weak" | "coverLetter";

function normalise(label: string): string {
  return label
    .replace(/[*✱:?!.…]+/g, " ")
    .replace(/\((?:optional|freiwillig|facultatif|opcional|необязательно)\)/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * What remains of `label` once the catch-all phrase and padding are gone: "Additional information
 * (e.g. portfolio link, availability)" leaves "portfolio link availability" — a real question.
 */
function specificRemainder(label: string, phrase: RegExp): string[] {
  const rest = label.replace(phrase, " ").replace(/[()[\],;/\-–—"'„“”]+/g, " ").replace(FILLER_RE, " ");
  return rest.split(/\s+/).filter((w) => /\p{L}{2}/u.test(w));
}

/**
 * The kind of catch-all a field label is, or null for a real question. A label that names
 * something specific next to the catch-all phrase ("Additional information: your notice
 * period") is a real question and returns null.
 */
export function catchAllKind(label: string): CatchAllKind | null {
  const text = normalise(label);
  if (!text) return null;
  if (COVER_LETTER_RE.test(text)) return "coverLetter";
  if (WEAK_RE.test(text)) return "weak";
  const strong = new RegExp(STRONG_RE.source, "giu");
  if (!strong.test(text)) return null;
  return specificRemainder(text, new RegExp(STRONG_RE.source, "giu")).length >= 3 ? null : "strong";
}

/**
 * Whether a field is a catch-all, given its label and what the form around it says: a strong
 * label always counts; a one-word "Comments"/"Nachricht" only when it's the last free-text field;
 * a cover-letter box only when the letter is already attached.
 */
export function isCatchAllField(label: string, opts: { isLastTextField?: boolean; coverLetterAttached?: boolean } = {}): boolean {
  const kind = catchAllKind(label);
  if (kind === "strong") return true;
  if (kind === "weak") return opts.isLastTextField !== false;
  if (kind === "coverLetter") return opts.coverLetterAttached === true;
  return false;
}

/**
 * A sentence in the posting that asks applicants to put something specific in their application
 * (a code word, a reference number, "please mention your earliest start date"). Only then is an
 * optional catch-all worth filling. Null when there's none.
 */
const POSTING_ASK_RES = [
  /\b(?:please|kindly)\b[^.!?\n]{0,100}\b(?:mention|include|state|indicate|tell\s+us|let\s+us\s+know|add|note|specify|quote|answer)\b[^.!?\n]{0,100}\b(?:application|cover\s+letter|message|submission)\b[^.!?\n]*/iu,
  /\bin\s+your\s+(?:application|cover\s+letter|message)\b[^.!?\n]{0,100}\b(?:mention|include|state|tell\s+us|let\s+us\s+know|answer|describe)\b[^.!?\n]*/iu,
  /\b(?:code\s?word|keyword|reference\s+(?:number|code)|kennwort|kennziffer|referenznummer|stichwort)\b[^.!?\n]*/iu,
  /\b(?:geben|nennen|teilen|erw[aä]hnen|beantworten)\s+sie\b[^.!?\n]{0,120}\b(?:bewerbung|anschreiben|nachricht)\b[^.!?\n]*/iu,
  /\bin\s+ihrer\s+bewerbung\b[^.!?\n]{0,120}\b(?:an|nennen|angeben|mitteilen|erw[aä]hnen|beantworten)\b[^.!?\n]*/iu,
];

export function postingSpecificAsk(job: Pick<Job, "description"> & Partial<Pick<Job, "requirements" | "responsibilities">>): string | null {
  const text = [job.description ?? "", ...(job.requirements ?? []), ...(job.responsibilities ?? [])].join("\n");
  for (const re of POSTING_ASK_RES) {
    const m = re.exec(text);
    if (m) return m[0].trim().slice(0, 300);
  }
  return null;
}

/** What the form already holds when a catch-all is answered, so the answer adds only what's new. */
export interface CatchAllContext {
  /** True/false when the form says; undefined when unknown (a question typed in by hand). */
  required?: boolean;
  /** Other fields' current values on the form (label → value). */
  formValues?: { label: string; value: string }[];
  /** Questions on the same form already answered in this run. */
  otherAnswers?: { question: string; answer: string }[];
  /** The cover letter is already attached as a file. */
  coverLetterAttached?: boolean;
}

export type CatchAllPlan =
  | { action: "skip" }
  | { action: "write"; reason: "required" | "posting" | "asked"; postingAsk?: string };

/**
 * Whether to write anything into a catch-all. Optional and nothing asked for → skip without a
 * model call. Required → a short answer. The posting asks for something specific → the model
 * writes just that (or skips). Requiredness unknown (asked by hand) → the model decides, empty
 * allowed.
 */
export function catchAllPlan(job: Pick<Job, "description"> & Partial<Pick<Job, "requirements" | "responsibilities">>, ctx: CatchAllContext): CatchAllPlan {
  if (ctx.required === true) return { action: "write", reason: "required", postingAsk: postingSpecificAsk(job) ?? undefined };
  const ask = postingSpecificAsk(job);
  if (ask) return { action: "write", reason: "posting", postingAsk: ask };
  if (ctx.required === false) return { action: "skip" };
  return { action: "write", reason: "asked" };
}
