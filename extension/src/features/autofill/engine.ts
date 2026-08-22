import type { Profile, ProfileFieldKey } from "@/types/profile";
import { detectSemanticField } from "./field-detector";
import { fillElement } from "./native-setter";

const FILLABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';

const EXCLUDED_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "checkbox", "radio", "file", "image"]);

function isFillable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement && EXCLUDED_INPUT_TYPES.has(el.type)) return false;
  if ((el as HTMLInputElement | HTMLTextAreaElement).disabled) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  return true;
}

function profileValue(profile: Profile, field: ProfileFieldKey): string {
  return profile[field] ?? "";
}

/**
 * Scans the page, detects each fillable field's semantic type, and fills it
 * from the profile (spec sections 12-13). Returns how many fields it could
 * confidently fill so the Side Panel can report progress.
 */
export function autofillDocument(profile: Profile): { filled: number; total: number } {
  const elements = Array.from(document.querySelectorAll(FILLABLE_SELECTOR)).filter(isFillable);

  let filled = 0;
  for (const el of elements) {
    const field = detectSemanticField(el);
    if (!field) continue;
    const value = profileValue(profile, field);
    if (!value) continue;
    if (fillElement(el, value)) filled++;
  }

  return { filled, total: elements.length };
}
