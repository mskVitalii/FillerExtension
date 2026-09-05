import type { ProfileFieldKey } from "@/types/profile";
import { FIELD_ORDER, FIELD_PATTERNS } from "./semantic-fields";

type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;

const AUTOCOMPLETE_MAP: Record<string, ProfileFieldKey> = {
  "given-name": "firstName",
  "family-name": "lastName",
  name: "fullName",
  email: "email",
  tel: "phone",
  "street-address": "address",
  "address-line1": "address",
  "address-level2": "city",
  "postal-code": "postalCode",
  country: "country",
  "country-name": "country",
  url: "website",
};

/**
 * `label.textContent` minus whatever text lives inside `exclude` itself —
 * a `<select>`'s own `<option>` labels are part of its `textContent`, so a
 * wrapping `<label>Question <select>…options…</select></label>` would
 * otherwise leak "Option1 Option2 …" into the label signal.
 */
function textExcluding(node: Node, exclude: Element): string {
  if (node === exclude) return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  let text = "";
  node.childNodes.forEach((child) => {
    text += textExcluding(child, exclude);
  });
  return text;
}

function labelForElement(el: FillableElement): string {
  const id = el.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) {
      const text = textExcluding(label, el);
      if (text) return text;
    }
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel) {
    const text = textExcluding(wrappingLabel, el);
    if (text) return text;
  }

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((refId) => document.getElementById(refId)?.textContent ?? "")
      .join(" ");
    if (text.trim()) return text;
  }
  return "";
}

/**
 * Text of the nearest preceding sibling *within the same parent* — e.g.
 * `<span>First Name</span><input>`. Deliberately never climbs past
 * `parentElement`: doing so previously leaked whole unrelated sections
 * (a prior fieldset, a neighboring label) into the signal and caused
 * false matches against earlier fields in FIELD_ORDER.
 */
function nearbyText(el: FillableElement): string {
  let node: ChildNode | null = el.previousSibling;
  while (node) {
    const text = node.textContent?.trim();
    if (text) return text;
    node = node.previousSibling;
  }
  return "";
}

interface Signal {
  text: string;
  /**
   * A machine identifier (`name` / `id` / `aria-label` / `data-testid`) —
   * deliberate, terse, and safe to test a short keyword pattern against.
   * The free-text signals (visible `<label>` / `aria-labelledby` text,
   * `placeholder`, nearby text) are not: on a custom application form the
   * "label" is often a whole question paragraph, and a keyword landing
   * inside it is noise, not a field type — e.g. "…specializing in *mobile*
   * interfaces" matched `phone`, "team eff*ort*" matched `city` (`ort\b`),
   * each stuffing a profile value into a free-text answer box. Those signals
   * are matched only when short enough to actually be a label.
   */
  identifier: boolean;
}

/** Word count past which a free-text signal reads as a question prompt, not a field label. */
const PROSE_WORD_COUNT = 10;

function isProse(text: string): boolean {
  return text.trim().split(/\s+/).length > PROSE_WORD_COUNT;
}

/**
 * Every label-ish signal attached to `el` (name, id, aria-label, label text,
 * placeholder, nearby text) — exported so other features that need to
 * classify an element by what it's labelled (e.g. `file-upload/inject-file.ts`
 * picking a CV-shaped file input) can reuse the same signal gathering instead
 * of re-deriving it.
 */
export function elementSignalParts(el: FillableElement): string[] {
  return signalParts(el).map((s) => s.text);
}

/** Signals in descending order of authority — a match on an earlier signal wins outright. */
function signalParts(el: FillableElement): Signal[] {
  return (
    [
      [el.getAttribute("name"), true],
      [el.getAttribute("id"), true],
      [el.getAttribute("aria-label"), true],
      [el.getAttribute("data-testid"), true],
      [labelForElement(el), false],
      [el.getAttribute("placeholder"), false],
      [nearbyText(el), false],
    ] as [string | null, boolean][]
  )
    .filter((part): part is [string, boolean] => Boolean(part[0]))
    .map(([text, identifier]) => ({ text, identifier }));
}

function matchField(signal: string): ProfileFieldKey | null {
  for (const field of FIELD_ORDER) {
    if (FIELD_PATTERNS[field].some((pattern) => pattern.test(signal))) return field;
  }
  return null;
}

/**
 * Maps a form element to a semantic profile field using layered signals
 * (spec section 12): a direct `autocomplete` token wins outright; otherwise
 * each signal (name, id, aria-label, label, placeholder, nearby text) is
 * tested independently in priority order and the first confident match
 * wins — signals are never concatenated, so a weak/noisy signal can never
 * override a strong one.
 */
export function detectSemanticField(el: FillableElement): ProfileFieldKey | null {
  const autocomplete = el.getAttribute("autocomplete")?.toLowerCase().trim();
  if (autocomplete && AUTOCOMPLETE_MAP[autocomplete]) {
    return AUTOCOMPLETE_MAP[autocomplete];
  }

  for (const { text, identifier } of signalParts(el)) {
    if (!identifier && isProse(text)) continue;
    const field = matchField(text);
    if (field) return field;
  }
  return null;
}
