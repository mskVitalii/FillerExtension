import type { Profile, ProfileFieldKey } from "@/types/profile";
import { detectSemanticField } from "./field-detector";
import { fillElement } from "./native-setter";
import { fillDialCodeField, findDialCodeField, fillSalaryField, resolvePhoneFill } from "./field-format";
import { findConfirmPasswordFields, isNewPasswordField } from "./password-fields";
import { countryCandidates } from "@/lib/country-codes";
import { generatePassword } from "@/lib/generate-password";

const FILLABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';

const EXCLUDED_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "checkbox", "radio", "file", "image"]);

function isFillable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement && EXCLUDED_INPUT_TYPES.has(el.type)) return false;
  if ((el as HTMLInputElement | HTMLTextAreaElement).disabled) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  return true;
}

/**
 * Elements inside an open shadow root (e.g. web-component-based ATS
 * widgets) are invisible to a plain `querySelectorAll` on `document` since
 * it doesn't pierce shadow boundaries. Walks every shadow root it can reach
 * (closed roots are inaccessible to any script, extension included — no
 * fix possible there) and collects matches from each. Reused by
 * custom-questions.ts so both passes see the same set of fields.
 */
export function queryFillableDeep(selector: string, root: ParentNode = document): HTMLElement[] {
  const found: HTMLElement[] = [];
  const walk = (node: ParentNode) => {
    found.push(...(Array.from(node.querySelectorAll(selector)) as HTMLElement[]));
    for (const el of node.querySelectorAll("*")) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(root);
  return found;
}

function profileValue(profile: Profile, field: ProfileFieldKey): string {
  return profile[field] ?? "";
}

/**
 * Fills one detected element, rendering the profile value into the shape the
 * field actually wants (spec sections 12-13): a phone number as `+49…` /
 * `0170…` / bare national + a sibling dial-code field; a salary as a bare
 * rounded integer when the field only accepts a number, or the matching
 * bracket option when it only offers discrete ranges to choose from; a
 * country under whichever spelling ("Germany"/"Deutschland"/"DE") the page's
 * `<select>` uses. Everything else is typed verbatim.
 */
async function fillSemanticField(el: HTMLElement, field: ProfileFieldKey, value: string, profile: Profile): Promise<boolean> {
  if (field === "phone") {
    const fill = resolvePhoneFill(el, value, profile.country);
    if (!fill) return fillElement(el, value);
    if (fill.dialCodeField) fillDialCodeField(fill.dialCodeField, fill.phone);
    return fillElement(el, fill.value);
  }

  if (field === "expectedSalary") {
    return fillSalaryField(el, value);
  }

  if (field === "country" && el instanceof HTMLSelectElement) {
    for (const candidate of countryCandidates(value)) {
      if (fillElement(el, candidate)) return true;
    }
    return false;
  }

  return fillElement(el, value);
}

/**
 * Registration forms need a *fresh* password, not a profile value, so this
 * is deliberately separate from the semantic-field pass above. It fills a
 * password box only when it reads as a *create-a-password* field — either
 * `autocomplete="new-password"` or the cluster of create-flow signals
 * `isNewPasswordField` looks for (policy/strength handler, strength-meter
 * `aria-describedby`, "choose/confirm your password" label, a sibling
 * confirmation field) — never an ordinary login field.
 */
function fillRegistrationPassword(elements: HTMLElement[]): { password: string | null; filled: number } {
  const newPasswordInputs = elements.filter(isNewPasswordField);
  if (newPasswordInputs.length === 0) return { password: null, filled: 0 };

  const targets = new Set<HTMLInputElement>(newPasswordInputs);
  for (const input of newPasswordInputs) {
    for (const confirmField of findConfirmPasswordFields(input)) targets.add(confirmField);
  }

  const password = generatePassword();
  let filled = 0;
  for (const el of targets) {
    if (fillElement(el, password)) filled++;
  }
  return { password: filled > 0 ? password : null, filled };
}

/**
 * Scans the page, detects each fillable field's semantic type, and fills it
 * from the profile (spec sections 12-13). Returns how many fields it could
 * confidently fill so the Side Panel can report progress, plus a freshly
 * generated password when the page looks like a registration form.
 *
 * Async, and fields are filled one at a time (not `Promise.all`): a
 * flyout-driven salary combobox (`fillSalaryField`) opens and closes its own
 * widget, and two open at once can steal each other's focus (see
 * `combobox.ts`).
 */
export async function autofillDocument(
  profile: Profile,
): Promise<{ filled: number; total: number; generatedPassword: string | null }> {
  const elements = queryFillableDeep(FILLABLE_SELECTOR).filter(isFillable);

  // A phone widget's own dial-code companion (e.g. greenhouse.io's
  // react-select "Country" flag/calling-code picker) is very often labelled
  // literally "Country" and would otherwise match the *address*-country
  // pattern too — `detectSemanticField` has no way to tell those two "country"
  // meanings apart on its own. `findDialCodeField` is the one place that
  // already knows which field belongs to a phone number, so anything it
  // claims is reserved here and skipped by the generic pass below — it's
  // filled (or correctly left alone) exclusively by the phone branch,
  // never mistaken for the applicant's own home-address country.
  const dialCodeFields = new Set<HTMLElement>();
  for (const el of elements) {
    if (detectSemanticField(el) === "phone") {
      const companion = findDialCodeField(el);
      if (companion) dialCodeFields.add(companion);
    }
  }

  let filled = 0;
  for (const el of elements) {
    // Defense in depth on top of the label-matching patterns themselves:
    // no profile value is ever a password, so a password-type input is
    // never a legitimate target for this pass regardless of what its label
    // happens to match — only fillRegistrationPassword() below is allowed
    // to write into one.
    if (el instanceof HTMLInputElement && el.type === "password") continue;
    if (dialCodeFields.has(el)) continue;
    const field = detectSemanticField(el);
    if (!field) continue;
    const value = profileValue(profile, field);
    if (!value) continue;
    if (await fillSemanticField(el, field, value, profile)) filled++;
  }

  const { password: generatedPassword, filled: passwordFilled } = fillRegistrationPassword(elements);
  filled += passwordFilled;

  return { filled, total: elements.length, generatedPassword };
}
