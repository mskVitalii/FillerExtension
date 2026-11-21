import { detectSemanticField } from "./field-detector";
import { cachedAiField } from "./ai-assist";
import { queryFillableDeep } from "./engine";
import { isGhostField } from "./dom-query";
import { fieldQuestionText, isQuestionShaped, nativeFieldOptions } from "./field-signal";
import { wantsNumericValue, dateInputKind } from "./field-format";
import { fillComboboxAnswer, revealComboboxOptions } from "./combobox";
import type { DateInputKind } from "@/lib/date-format";
import type { ElementLocator } from "./element-locator";
import { guardFills, readValue, type GuardedFill } from "./refill-guard";
import { activeAtsAdapter, atsFieldLabel, isAtsIgnored, withAtsCache } from "./ats";
import type { AtsAdapter } from "./ats/types";
import { isRevealedPasswordField } from "./password-fields";
import { buildLocator } from "./element-locator";
import { backingSelect, repaintFacade } from "./select-facade";
import { pageRadioQuestions } from "./pick-questions";
import { looksLikeSalutationOptions } from "@/lib/salutation";
import { fillElement } from "./native-setter";
import { catchAllKind, isCatchAllField } from "./catch-all";

const FILLABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';
const EXCLUDED_INPUT_TYPES = new Set([
  "hidden",
  "submit",
  "button",
  "reset",
  "checkbox",
  "radio",
  "file",
  "image",
  "password",
]);

export interface CustomQuestion {
  id: string;
  question: string;
  /**
   * Present only for questions added via the visual element picker
   * (`element-picker.ts`). The automatic scan omits it — it re-scans and
   * matches by `question` text; picked fields often have no such text, so
   * their answer is written back by locator instead.
   */
  locator?: ElementLocator;
  /** Choice labels when the picked field is a radio-group / `<select>` — the answer must be one of these. */
  options?: string[];
  /** True for a "select all that apply" checkbox-group question — the answer may name more than one of `options`. */
  multi?: boolean;
  /** True when the field only accepts a bare number — the AI must answer with digits only, no currency/units/prose. */
  numeric?: boolean;
  /** Present when the field is a `date`/`month`/`week`/`time`/`datetime-local` input — the answer must be in that exact format. */
  dateKind?: DateInputKind;
  /**
   * A catch-all ("Additional information", "Sonstiges", "Message to the hiring team") rather than
   * a real question (`catch-all.ts`): answered only when required or the posting asks for
   * something specific, and never with what the form already holds.
   */
  catchAll?: boolean;
  /** The form marks the field required. Set on catch-alls, where it decides whether to answer. */
  required?: boolean;
  /** For a catch-all: the other fields' values on the form at scan time, so the answer doesn't repeat them. */
  formValues?: { label: string; value: string }[];
  /** For a catch-all: a cover letter is already attached in a file field of the form. */
  coverLetterAttached?: boolean;
}

/**
 * A site's own search box, never an application question: LinkedIn's job
 * search ("Describe the job you want") sits in `<header> … [role="search"]`
 * above every posting, and its placeholder reads like a question. Matched by
 * the search landmark (ARIA role or `<search>`), `type="search"` or site
 * navigation, so a real form field is never caught by it.
 */
const SEARCH_CONTAINER_SELECTOR = '[role="search"], search, nav, [role="navigation"]';

/**
 * The page's own header and footer: Personio's language switcher ("Select language, current:
 * English", a `role="combobox"` button) sits in `<header role="banner">`. A form that lives
 * inside the header itself (a newsletter sign-up, say) still counts.
 */
const PAGE_CHROME_SELECTOR = 'header, footer, [role="banner"], [role="contentinfo"]';

function isSiteSearchField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type === "search") return true;
  if (el.closest(SEARCH_CONTAINER_SELECTOR) !== null) return true;
  const chrome = el.closest(PAGE_CHROME_SELECTOR);
  if (!chrome) return false;
  const form = el.closest("form");
  return !(form && chrome.contains(form));
}

function isFillable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement && EXCLUDED_INPUT_TYPES.has(el.type)) return false;
  if (isSiteSearchField(el)) return false;
  if ((el as HTMLInputElement | HTMLTextAreaElement).disabled) return false;
  if (isGhostField(el)) return false;
  // Voluntary EEO / demographic surveys stay unanswered (ats/index.ts).
  if (isAtsIgnored(el)) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  return true;
}

interface QuestionField {
  question: string;
  el: HTMLElement;
  /** Choice labels when `el` is a `<select>` — the answer must be one of these (mirrors the picker's `options`). */
  options?: string[];
  /** `el` only accepts a bare number (e.g. `<input type="number">` — a salary/years-of-experience question). */
  numeric?: boolean;
  /** `el`'s required date/time format, e.g. `<input type="date">` — an available-from/start-date question. */
  dateKind?: DateInputKind;
  /** When `el` is a select2/selectmenu/chosen facade: the native `<select>` it stands for, which takes the answer. */
  select?: HTMLSelectElement;
}

const REQUIRED_MARK_SELECTOR = ".required-mark, .required, .asterisk, .mustsign, .form_content_label_mustsign, abbr[title*=required i]";

/** `required`/`aria-required`, or a "*" marker in the field's `<label for>` / Umantis' label column. */
function isRequiredField(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).required || el.getAttribute("aria-required") === "true") return true;
  const label = el.id ? el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`) : el.closest("label");
  return Boolean(label && (label.querySelector(REQUIRED_MARK_SELECTOR) || /\*\s*:?\s*$/.test(label.textContent ?? "")));
}

/** A short field name ("Notice Period", "Current company") rather than an instruction to type. */
const INSTRUCTION_RE = /^(type|enter|write|select|choose|pick|start typing|search)\b/i;

function isShortLabel(text: string): boolean {
  return /\p{L}{2}/u.test(text) && !INSTRUCTION_RE.test(text) && text.split(/\s+/).length <= 10;
}

/**
 * The question to ask about `el`, or "" when it isn't one. The ATS adapter's own question text
 * (`questionText`, e.g. one section of Workday's split date widget) replaces the field's label,
 * and a select facade is asked by its native `<select>`'s label. A label shaped like a question
 * wins; otherwise the ATS's own question title (a Lever card, an Ashby entry). A shorter label
 * still counts when
 *  - the field is a choice: its options say what is being asked ("Schulabschluss",
 *    "Deutschkenntnisse:", "Berufserfahrung");
 *  - the field is required: "Notice Period*" on Greenhouse, "Staatsangehörigkeit:*" — the form
 *    can't be sent without an answer, and the answer step decides whether the applicant's data
 *    has one.
 */
function questionFor(el: HTMLElement, ats: AtsAdapter | null, select: HTMLSelectElement | undefined, options: string[] | undefined): string {
  const question = (ats?.questionText?.(el) ?? ((select && fieldQuestionText(select)) || fieldQuestionText(el))).trim();
  if (isQuestionShaped(question)) return question;
  const atsLabel = atsFieldLabel(el);
  if (isQuestionShaped(atsLabel)) return atsLabel;
  const label = question || atsLabel;
  if (options !== undefined && options.length > 1 && /\p{L}{3,}/u.test(label)) return label;
  return isRequiredField(select ?? el) && isShortLabel(label) ? label.replace(/[\s*✱]+$/, "") : "";
}

/**
 * Free-text fields the semantic autofill engine (field-detector.ts) doesn't
 * recognize as a known profile field, but whose label reads like an actual
 * application question (spec_2 item 5) — e.g. "Why do you want to work
 * here?" — rather than an unmatched but ordinary field. Deterministic: the
 * question *text* is `field-signal.ts#fieldQuestionText` (shared with the
 * visual picker — label → aria → nearby preceding text → placeholder), so
 * re-scanning later and matching by that text finds the same element again
 * (used by `fillCustomQuestionAnswers`). Using the same richer signal here
 * (rather than a simpler label/aria/placeholder-only lookup this module used
 * to have of its own) matters concretely: a field with no real label whose
 * question lives in a sibling `<p>` above it — e.g. a custom question card
 * with nothing but a generic "Type your answer here…" placeholder — used to
 * be misdetected as *that placeholder itself* being the question, so the AI
 * was asked to answer "Type your answer here…" and correctly replied with a
 * "please provide the actual question" non-answer, which still got written
 * into the field. `fieldQuestionText`'s nearby-text climb finds the real `<p>`
 * instead; `isQuestionShaped` additionally rejects a signal that's nothing
 * but that generic placeholder text, so a field with truly no findable
 * question is skipped here rather than faked into one.
 */
function scanQuestionFields(ats: AtsAdapter | null = activeAtsAdapter()): QuestionField[] {
  const found = queryFillableDeep(FILLABLE_SELECTOR);
  for (const el of ats?.extraFillables?.(document) ?? []) if (!found.includes(el)) found.push(el);
  const elements = found.filter(isFillable);
  // A select widget's facade and its native <select> are one question, asked once (the facade is
  // what the user sees; the select holds the options and takes the answer — `select-facade.ts`).
  const facadeSelect = new Map<HTMLElement, HTMLSelectElement>();
  for (const el of elements) {
    const select = backingSelect(el);
    if (select) facadeSelect.set(el, select);
  }
  const selectsWithFacade = new Set<HTMLElement>(facadeSelect.values());

  const fields: QuestionField[] = [];
  for (const el of elements) {
    if (selectsWithFacade.has(el)) continue;
    if (isRevealedPasswordField(el)) continue;
    const select = facadeSelect.get(el);
    if (detectSemanticField(el) || (select && detectSemanticField(select))) continue;
    // A profile field the Autofill's AI pass recognised (`ai-assist.ts`) is the profile's, not a question.
    if (cachedAiField(select ?? el)) continue;
    const options = nativeFieldOptions(select ?? el);
    const question = questionFor(el, ats, select, options);
    if (!question) continue;
    fields.push({
      question,
      el,
      options,
      numeric: wantsNumericValue(el) || undefined,
      dateKind: dateInputKind(el) ?? undefined,
      select,
    });
  }
  return fields;
}

/**
 * Async because of `revealComboboxOptions` (spec_5 section A): a field with
 * no deterministic `<select>`/`<datalist>` options gets one best-effort,
 * time-boxed probe to see whether it's a combobox hiding its choices until
 * opened. Every other field resolves immediately, so this only adds
 * latency when there's actually a combobox-shaped field to probe — and
 * those probes run one at a time (not `Promise.all`), since two widgets
 * open at once can steal each other's focus and cross-contaminate each
 * other's revealed option list (see `revealComboboxOptions`'s docstring).
 */
async function detectCustomQuestionsUncached(): Promise<CustomQuestion[]> {
  const ats = activeAtsAdapter();
  const fields = scanQuestionFields(ats);
  for (const field of fields) {
    // The ATS adapter knows its own widgets (Workday's listbox buttons, UI5 selects, date sections).
    const hints = await ats?.questionHints?.(field.el).catch(() => undefined);
    if (hints?.options && !field.options) field.options = hints.options;
    if (hints?.dateKind && !field.dateKind) field.dateKind = hints.dateKind;
    if (!field.options) field.options = await revealComboboxOptions(field.el);
  }
  const questions: CustomQuestion[] = fields.map((field, index) => ({
    id: `question-${index}`,
    question: field.question,
    options: field.options,
    numeric: field.numeric,
    dateKind: field.dateKind,
    ...catchAllInfo(field),
  }));
  return [...questions, ...radioQuestions(questions.length)];
}

const TEXT_INPUT_TYPES = new Set(["", "text"]);

/** A field the applicant writes prose into: a textarea, a plain text input or a contenteditable. */
function isFreeTextField(el: HTMLElement): boolean {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(el.getAttribute("type")?.toLowerCase() ?? "");
  return el.isContentEditable || el.getAttribute("contenteditable") === "true";
}

function formRoot(el: HTMLElement): ParentNode {
  return el.closest("form") ?? el.ownerDocument;
}

/** No other free-text field follows `el` in its form: the "anything else?" box sits at the end. */
function isLastFreeTextField(el: HTMLElement): boolean {
  const later = [...formRoot(el).querySelectorAll<HTMLElement>('textarea, input, [contenteditable="true"]')].filter(
    (other) => other !== el && isFreeTextField(other) && isFillable(other) && el.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
  return later.length === 0;
}

const COVER_LETTER_FILE_RE = /cover|anschreiben|motivation|lettre|anschr/i;

/** A file field of the form already holds a cover letter (its file name, or the field's label, says so). */
function hasAttachedCoverLetter(el: HTMLElement): boolean {
  for (const input of formRoot(el).querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    const files = [...(input.files ?? [])];
    if (files.length === 0) continue;
    if (files.some((f) => COVER_LETTER_FILE_RE.test(f.name)) || COVER_LETTER_FILE_RE.test(fieldQuestionText(input))) return true;
  }
  return false;
}

/** The other filled fields of `el`'s form (label → value), capped, for a catch-all's "don't repeat" list. */
function otherFormValues(el: HTMLElement): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const other of formRoot(el).querySelectorAll<HTMLElement>(FILLABLE_SELECTOR)) {
    if (other === el || !isFillable(other)) continue;
    const value = readValue(other);
    if (!value) continue;
    const label = fieldQuestionText(other) || other.getAttribute("name") || "";
    out.push({ label: label.slice(0, 80), value: value.slice(0, 200) });
    if (out.length >= 40) break;
  }
  return out;
}

/** The catch-all fields of a `CustomQuestion` (empty for a real question). */
function catchAllInfo(field: QuestionField): Partial<CustomQuestion> {
  if (field.options || field.numeric || field.dateKind || !isFreeTextField(field.el)) return {};
  const kind = catchAllKind(field.question);
  if (!kind) return {};
  const coverLetterAttached = kind === "coverLetter" ? hasAttachedCoverLetter(field.el) : undefined;
  const isLast = kind === "weak" ? isLastFreeTextField(field.el) : undefined;
  if (!isCatchAllField(field.question, { isLastTextField: isLast, coverLetterAttached })) return {};
  return {
    catchAll: true,
    required: isRequiredField(field.el),
    formValues: otherFormValues(field.el),
    coverLetterAttached: coverLetterAttached || undefined,
  };
}

/**
 * Radio-group questions (Ja/Nein screening questions, a consent asked as Ja/Nein, a start-date
 * choice). They carry a `locator`, so their answers go back through `fillAnswersByLocator`, like
 * a picked group. Skipped: a group the page already answered, and a salutation group, which the
 * autofill engine fills from the profile.
 */
function radioQuestions(offset: number): CustomQuestion[] {
  const out: CustomQuestion[] = [];
  for (const { groupEl, radios, question, options } of pageRadioQuestions()) {
    if (radios.some((r) => r.checked) || radios.every((r) => !isVisibleRadio(r))) continue;
    // A voluntary EEO / demographic survey stays unanswered (ats/).
    if (radios.some(isAtsIgnored)) continue;
    if (looksLikeSalutationOptions(options) || detectSemanticField(radios[0]) === "salutation") continue;
    if (!question || options.length < 2) continue;
    out.push({
      id: `question-${offset + out.length}`,
      question,
      locator: buildLocator(groupEl, question),
      options,
    });
  }
  return out;
}

/** A radio counts as visible when it is, or its `<label for>` is (a styled radio hides the input). */
function isVisibleRadio(r: HTMLInputElement): boolean {
  if (r.offsetParent !== null) return true;
  const label = r.id ? r.ownerDocument.querySelector<HTMLElement>(`label[for="${CSS.escape(r.id)}"]`) : null;
  return label !== null && label.offsetParent !== null;
}

/** The fields `detectCustomQuestions` found, for the on-page highlight (`field-highlight.ts`). */
export function questionFieldTargets(): { el: HTMLElement; label: string; locate: () => HTMLElement | null }[] {
  return scanQuestionFields().map(({ el, question }) => ({
    el,
    label: question.slice(0, 80),
    locate: () => scanQuestionFields().find((f) => f.question === question)?.el ?? null,
  }));
}

/**
 * The key `answerAndFillQuestions` (Side Panel) uses to store/look up one
 * question's answer. Picker-added questions must key off their `locator`,
 * not `question` text: several fields on the *same* custom-built form
 * routinely share an identical generic prompt — e.g. two "Type your answer
 * here…" textareas whose real question lives in a sibling `<p>` the
 * deterministic pass didn't attach — and text-keying would silently
 * collapse them into one answer slot, leaving one field unanswered/wrong.
 * The automatic scan has no locator and must stay text-keyed: it re-matches
 * elements by that same text on every re-scan (`fillCustomQuestionAnswers`).
 */
export function questionAnswerKey(q: Pick<CustomQuestion, "question" | "locator">): string {
  return q.locator ? `loc:${q.locator.tag}` : q.question;
}

/**
 * A `role="combobox"` trigger with no real selection yet very often still
 * has non-empty `textContent` — its own placeholder ("Select your level",
 * "Choose…", "--") is rendered as visible text rather than carried in a
 * `placeholder` attribute the way a plain `<input>` would. Without this, a
 * freshly-detected combobox reads as "already answered" from the moment
 * it's scanned and `fillCustomQuestionAnswers` would skip it forever —
 * the AI answer never gets written in. Intentionally narrow (a fixed set of
 * placeholder-shaped phrases) so a combobox that already shows a genuine
 * selected option — which is exactly what this function exists to protect
 * — is never mistaken for an empty one.
 */
const COMBOBOX_PLACEHOLDER_RE = /^(select|choose|pick)\b|^-+$|^(bitte\s+)?(aus)?w(ä|ae)hlen\b/i;

function isEmptyField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim() === "";
  }
  const text = (el.textContent ?? "").trim();
  if (!text) return true;
  // A dropdown trigger — `role="combobox"`, or a `<button aria-haspopup="listbox">` (Workday) — showing its placeholder.
  const isTrigger = el.getAttribute("role") === "combobox" || el.getAttribute("aria-haspopup") === "listbox";
  return isTrigger && COMBOBOX_PLACEHOLDER_RE.test(text);
}

/**
 * Writes AI-generated answers back into their fields. Re-scans rather than
 * holding element references from an earlier `detectCustomQuestions` call —
 * keeps this stateless across the detect → answer → fill round-trip and
 * resilient to the form re-rendering in between. Skips any field the user
 * has already typed into (this runs automatically, so it must never clobber
 * a manual answer). Returns how many fields were filled, plus the question
 * text of any that had an answer ready but couldn't be written in — e.g. a
 * flyout combobox whose site gates opening on a trusted click (see
 * `fillComboboxAnswer`) — so the Side Panel can tell the user to answer
 * those manually instead of silently leaving them blank.
 *
 * Async, and fields are filled one at a time (not `Promise.all`): a
 * flyout-driven combobox answer (`fillComboboxAnswer`) opens and closes the
 * widget itself, same one-at-a-time constraint `revealComboboxOptions` (used
 * during detection) already documents.
 */
async function fillCustomQuestionAnswersUncached(
  answers: Record<string, string>,
): Promise<{ filled: number; unfilled: string[] }> {
  let filled = 0;
  const unfilled: string[] = [];
  const guarded: GuardedFill[] = [];
  const ats = activeAtsAdapter();
  const write = (target: HTMLElement, answer: string) => ats?.fillAnswer?.(target, answer) ?? fillComboboxAnswer(target, answer);
  for (const { question, el, select } of scanQuestionFields(ats)) {
    const answer = answers[question];
    if (!answer || !isEmptyField(select ?? el)) continue;
    if (select) {
      // A facade: the native select takes the answer, the facade is repainted to show it.
      if (fillElement(select, answer)) {
        repaintFacade(el, select);
        filled++;
      } else unfilled.push(question);
      continue;
    }
    const before = readValue(el);
    if (await write(el, answer)) {
      filled++;
      guarded.push({
        el,
        before,
        // Re-found the same way this function found it: by its question text.
        locate: () => scanQuestionFields().find((f) => f.question === question)?.el ?? null,
        refill: (fresh) => write(fresh, answer),
      });
    } else unfilled.push(question);
  }
  void guardFills(guarded);
  return { filled, unfilled };
}

/** `detectCustomQuestionsUncached` with ATS detection memoised for the whole run (`withAtsCache`). */
export function detectCustomQuestions(...args: Parameters<typeof detectCustomQuestionsUncached>): ReturnType<typeof detectCustomQuestionsUncached> {
  return withAtsCache(() => detectCustomQuestionsUncached(...args));
}

/** `fillCustomQuestionAnswersUncached` with ATS detection memoised for the whole run (`withAtsCache`). */
export function fillCustomQuestionAnswers(...args: Parameters<typeof fillCustomQuestionAnswersUncached>): ReturnType<typeof fillCustomQuestionAnswersUncached> {
  return withAtsCache(() => fillCustomQuestionAnswersUncached(...args));
}
