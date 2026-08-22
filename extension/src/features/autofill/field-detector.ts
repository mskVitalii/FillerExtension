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

function labelForElement(el: FillableElement): string {
  const id = el.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent) return label.textContent;
  }
  const wrappingLabel = el.closest("label");
  if (wrappingLabel?.textContent) return wrappingLabel.textContent;

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

/** Signals in descending order of authority — a match on an earlier signal wins outright. */
function signalParts(el: FillableElement): string[] {
  return [
    el.getAttribute("name"),
    el.getAttribute("id"),
    el.getAttribute("aria-label"),
    el.getAttribute("data-testid"),
    labelForElement(el),
    el.getAttribute("placeholder"),
    nearbyText(el),
  ].filter((part): part is string => Boolean(part));
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

  for (const signal of signalParts(el)) {
    const field = matchField(signal);
    if (field) return field;
  }
  return null;
}
