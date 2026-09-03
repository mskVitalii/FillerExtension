import { queryFillableDeep } from "./engine";

/**
 * Consent / marketing checkboxes on an application form (spec_2 — extends
 * the autofill pass, which deliberately skips checkboxes). The engine can't
 * decide these from the DOM alone — "I accept the privacy policy" must be
 * ticked, "send me career newsletters" must not, and the wording varies by
 * site and language — so this module only *collects* the candidates and
 * *applies* a decision made by the AI pass (features/openai/decide-checkboxes.ts).
 */

const CHECKBOX_SELECTOR = 'input[type="checkbox"], [role="checkbox"]';

const CONSENT_HINT_RE =
  /consent|agree|accept|terms|privacy|policy|gdpr|data\s*protection|process(?:ing)?\s+(?:my|your|personal)?\s*data|newsletter|marketing|subscribe|updates?|promotion|einwillig|zustimm|akzeptier|einverstanden|datenschutz|agb|bedingungen|einwilligung|werbung|benachrichtigung|abonnier|talent\s*pool|talentpool|bewerberpool/i;

export interface PageCheckbox {
  /** Stable only within one detect pass — matching across detect→apply goes by name/label. */
  id: string;
  label: string;
  name: string;
  required: boolean;
  checked: boolean;
}

export interface CheckboxDecisionInput {
  name: string;
  label: string;
  check: boolean;
}

function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent !== null) return true;
  return getComputedStyle(el).position === "fixed";
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function labelText(el: HTMLElement): string {
  const doc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id) {
    const forLabel = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (forLabel?.textContent && collapse(forLabel.textContent)) return collapse(forLabel.textContent);
  }
  const wrapping = el.closest("label");
  if (wrapping?.textContent && collapse(wrapping.textContent)) return collapse(wrapping.textContent);

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = collapse(
      labelledBy
        .split(/\s+/)
        .map((refId) => doc.getElementById(refId)?.textContent ?? "")
        .join(" "),
    );
    if (text) return text;
  }
  const aria = el.getAttribute("aria-label");
  if (aria && collapse(aria)) return collapse(aria);

  // A checkbox with no proper label: fall back to the text of the closest
  // ancestor that carries a sentence's worth of it.
  let node: HTMLElement | null = el.parentElement;
  for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
    const text = collapse(node.textContent ?? "");
    if (text.split(" ").length >= 3) return text;
  }
  return "";
}

function isChecked(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  return el.getAttribute("aria-checked") === "true";
}

function isRequired(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.required) return true;
  return el.getAttribute("aria-required") === "true";
}

function inApplicationForm(el: HTMLElement): boolean {
  const form = (el as HTMLInputElement).form ?? el.closest("form");
  if (!form) return false;
  // A real application form also has something to type into — this filters
  // out search / job-filter forms that are nothing but checkboxes.
  return Boolean(form.querySelector('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]), textarea'));
}

function checkboxElements(): HTMLElement[] {
  return queryFillableDeep(CHECKBOX_SELECTOR).filter((el): el is HTMLElement => {
    if (!(el instanceof HTMLElement)) return false;
    if (el instanceof HTMLInputElement && el.disabled) return false;
    if (el.getAttribute("aria-disabled") === "true") return false;
    return isVisible(el);
  });
}

/**
 * Checkboxes worth asking the AI about: those on an application form whose
 * label reads like a consent/marketing statement, or that the form marks
 * required. Plain one-word toggles are left alone.
 */
export function detectCheckboxes(): PageCheckbox[] {
  const out: PageCheckbox[] = [];
  checkboxElements().forEach((el, index) => {
    if (!inApplicationForm(el)) return;
    const label = labelText(el).slice(0, 400);
    const required = isRequired(el);
    if (!required && label.split(" ").length < 4 && !CONSENT_HINT_RE.test(label)) return;

    out.push({
      id: `checkbox-${index}`,
      label,
      name: el.getAttribute("name") ?? "",
      required,
      checked: isChecked(el),
    });
  });
  return out;
}

function setChecked(el: HTMLElement, checked: boolean): boolean {
  if (isChecked(el) === checked) return false;

  if (typeof (el as HTMLElement).focus === "function") el.focus();
  el.click();
  if (isChecked(el) === checked) return true;

  // A framework swallowed the click — force the state and notify it directly.
  if (el instanceof HTMLInputElement) {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
    descriptor?.set?.call(el, checked);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    el.setAttribute("aria-checked", String(checked));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  return true;
}

/**
 * Applies AI decisions: re-scans (stateless, like the questions pass) and
 * matches each checkbox by `name`, then by exact label text. Returns how
 * many checkboxes actually changed state.
 */
export function applyCheckboxDecisions(decisions: CheckboxDecisionInput[]): number {
  if (decisions.length === 0) return 0;
  let changed = 0;

  for (const el of checkboxElements()) {
    if (!inApplicationForm(el)) continue;
    const name = el.getAttribute("name") ?? "";
    const label = labelText(el).slice(0, 400);
    const decision =
      (name && decisions.find((d) => d.name && d.name === name)) ||
      decisions.find((d) => d.label && d.label === label);
    if (!decision) continue;
    if (setChecked(el, decision.check)) changed++;
  }
  return changed;
}
