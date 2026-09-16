import { detectSemanticField } from "./field-detector";
import { queryFillableDeep } from "./engine";
import { fieldQuestionText, isQuestionShaped, nativeFieldOptions } from "./field-signal";
import { wantsNumericValue, dateInputKind } from "./field-format";
import { fillComboboxAnswer, revealComboboxOptions } from "./combobox";
import type { DateInputKind } from "@/lib/date-format";
import type { ElementLocator } from "./element-locator";

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
}

function isFillable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement && EXCLUDED_INPUT_TYPES.has(el.type)) return false;
  if ((el as HTMLInputElement | HTMLTextAreaElement).disabled) return false;
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
function scanQuestionFields(): QuestionField[] {
  const elements = queryFillableDeep(FILLABLE_SELECTOR).filter(isFillable);

  const fields: QuestionField[] = [];
  for (const el of elements) {
    if (detectSemanticField(el)) continue;
    const question = fieldQuestionText(el).trim();
    if (!isQuestionShaped(question)) continue;
    fields.push({
      question,
      el,
      options: nativeFieldOptions(el),
      numeric: wantsNumericValue(el) || undefined,
      dateKind: dateInputKind(el) ?? undefined,
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
export async function detectCustomQuestions(): Promise<CustomQuestion[]> {
  const fields = scanQuestionFields();
  for (const field of fields) {
    if (!field.options) field.options = await revealComboboxOptions(field.el);
  }
  return fields.map((field, index) => ({
    id: `question-${index}`,
    question: field.question,
    options: field.options,
    numeric: field.numeric,
    dateKind: field.dateKind,
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
const COMBOBOX_PLACEHOLDER_RE = /^(select|choose|pick)\b|^-+$/i;

function isEmptyField(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value.trim() === "";
  }
  const text = (el.textContent ?? "").trim();
  if (!text) return true;
  return el.getAttribute("role") === "combobox" && COMBOBOX_PLACEHOLDER_RE.test(text);
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
export async function fillCustomQuestionAnswers(
  answers: Record<string, string>,
): Promise<{ filled: number; unfilled: string[] }> {
  let filled = 0;
  const unfilled: string[] = [];
  for (const { question, el } of scanQuestionFields()) {
    const answer = answers[question];
    if (!answer || !isEmptyField(el)) continue;
    if (await fillComboboxAnswer(el, answer)) filled++;
    else unfilled.push(question);
  }
  return { filled, unfilled };
}
