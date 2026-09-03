import { resolvePhone, type ResolvedPhone } from "@/lib/phone";
import { salaryNumericValue } from "@/lib/salary";
import { fillElement } from "./native-setter";

/**
 * Renders a profile value into the exact shape the *target field* wants,
 * rather than typing the stored string verbatim. Two cases matter in
 * practice (spec: the salary example field runs `validateNumeric`, phone
 * fields disagree on `+49` vs `0` vs a separate dial-code box):
 *
 *  - salary → a bare rounded integer when the field only accepts a number
 *  - phone  → `+49…` / `0170…` / bare national, matched to the field's
 *             format hints and any sibling country-code field
 */

const INLINE_HANDLER_ATTRS = ["onblur", "oninput", "onchange", "onkeyup", "onkeydown", "onkeypress"];
const NUMERIC_HANDLER_RE = /validate\s*numeric|isnan|parse(?:int|float)|numberformat|[^a-z](?:numeric|digits?|ziffer|zahl)[^a-z]/i;
const NUMERIC_DATA_VALUES = new Set([
  "number",
  "numeric",
  "integer",
  "int",
  "digits",
  "decimal",
  "currency",
  "money",
  "float",
]);

/** True when `el` will only accept a plain number (so `+49…` / `€65k` would fail its validation). */
export function wantsNumericValue(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement) {
    if (el.type === "number") return true;
    if (el.type === "tel") return false;
  }

  const inputMode = el.getAttribute("inputmode")?.toLowerCase();
  if (inputMode === "numeric" || inputMode === "decimal") return true;

  const pattern = el.getAttribute("pattern");
  if (pattern && /^[\^$\\d0-9()[\]{}.,*+?|\s-]+$/.test(pattern) && /\d|\\d|0-9/.test(pattern)) {
    return true;
  }

  for (const attr of ["data-type", "data-format", "data-validate", "data-validation", "data-rule"]) {
    const value = el.getAttribute(attr)?.toLowerCase().trim();
    if (value && NUMERIC_DATA_VALUES.has(value)) return true;
  }

  for (const attr of INLINE_HANDLER_ATTRS) {
    const handler = el.getAttribute(attr);
    if (handler && NUMERIC_HANDLER_RE.test(handler)) return true;
  }

  if ((el.getAttribute("class") ?? "").split(/\s+/).some((c) => /^(numeric|number|digits|currency)$/i.test(c))) {
    return true;
  }

  return false;
}

/** Salary string to type into `el` — a rounded integer for number-only fields, else the raw input. */
export function formatSalaryForField(el: HTMLElement, raw: string): string {
  const numeric = salaryNumericValue(raw);
  if (numeric === null) return raw;
  if (wantsNumericValue(el)) return numeric;
  // Free-text field: the parsed-and-rounded figure is still the cleanest
  // thing to type (the user asked to enter it once and have the format
  // sorted out), and it stays valid everywhere.
  return numeric;
}

// --- phone -----------------------------------------------------------------

const DIAL_CODE_SIGNAL_RE =
  /(country|phone|tel|telephone|mobile|international|dial(?:l?ing)?|calling|area)[\s_-]*(code|prefix)|country[\s_-]?code|vorwahl|l[aä]ndervorwahl|landesvorwahl|indicatif|prefij|prefiss|kod\s*kraju/i;
const INTERNATIONAL_HINT_RE =
  /e\.?\s?164|country\s*code|with\s*country|international|mit\s*(?:landes)?vorwahl|internationale/i;
const NATIONAL_HINT_RE = /national|ohne\s*(?:landes)?vorwahl|without\s*country|local\s*format|inl[aä]nd/i;

function signalText(el: HTMLElement): string {
  return [
    el.getAttribute("name"),
    el.getAttribute("id"),
    el.getAttribute("aria-label"),
    el.getAttribute("placeholder"),
    el.getAttribute("title"),
    el.getAttribute("pattern"),
  ]
    .filter(Boolean)
    .join(" ");
}

function isFieldElement(el: Element): el is HTMLElement {
  return (
    (el instanceof HTMLInputElement && !["hidden", "submit", "button", "reset"].includes(el.type)) ||
    el instanceof HTMLSelectElement
  );
}

/** Nearest form, or a bounded ancestor if the field isn't in a `<form>`. */
function fieldGroup(el: HTMLElement): ParentNode {
  const form = (el as HTMLInputElement).form ?? el.closest("form");
  if (form) return form;
  let node: HTMLElement | null = el;
  for (let i = 0; i < 4 && node?.parentElement; i++) node = node.parentElement;
  return node ?? document;
}

function optionStrings(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => `${o.value} ${o.textContent ?? ""}`.trim());
}

/**
 * A sibling field that takes the country calling code on its own — either
 * labelled as one, or a `<select>` whose options are mostly `+49` / `0049` /
 * `Germany (+49)` shaped.
 */
export function findDialCodeField(phoneEl: HTMLElement): HTMLElement | null {
  const group = fieldGroup(phoneEl);
  const candidates = Array.from(group.querySelectorAll("input, select")).filter(
    (el): el is HTMLElement => isFieldElement(el) && el !== phoneEl,
  );

  for (const el of candidates) {
    if (DIAL_CODE_SIGNAL_RE.test(signalText(el))) return el;
  }

  for (const el of candidates) {
    if (!(el instanceof HTMLSelectElement) || el.options.length < 2) continue;
    const opts = optionStrings(el).filter((s) => s);
    const dialShaped = opts.filter((s) => /(\+\d{1,4})|^00\d{1,4}$|^\+?\d{1,4}$/.test(s));
    if (dialShaped.length / opts.length >= 0.6 && opts.some((s) => s.includes("+"))) return el;
  }

  return null;
}

function fillSelectFromCandidates(select: HTMLSelectElement, candidates: string[]): boolean {
  const wanted = candidates.map((c) => c.toLowerCase().trim()).filter(Boolean);
  const option = Array.from(select.options).find((opt) => {
    const value = opt.value.trim().toLowerCase();
    const text = (opt.textContent ?? "").trim().toLowerCase();
    return wanted.some((w) => value === w || text === w || text.includes(`(${w})`) || text.includes(`+${w}`));
  });
  if (!option) return false;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  descriptor?.set?.call(select, option.value);
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/** Fills a detected dial-code companion field. Returns whether it took. */
export function fillDialCodeField(el: HTMLElement, phone: ResolvedPhone): boolean {
  const cc = phone.callingCode;
  const candidates = [`+${cc}`, cc, `00${cc}`, `+ ${cc}`];
  if (phone.iso2) candidates.push(phone.iso2, phone.iso2.toLowerCase());

  if (el instanceof HTMLSelectElement) return fillSelectFromCandidates(el, candidates);

  if (el instanceof HTMLInputElement) {
    const hint = `${el.value} ${el.getAttribute("placeholder") ?? ""}`;
    const value = hint.includes("00") && !hint.includes("+") ? `00${cc}` : `+${cc}`;
    return fillElement(el, value);
  }
  return false;
}

export interface PhoneFill {
  /** Value for the phone field itself. */
  value: string;
  /** A dial-code companion field to fill first, if one was found. */
  dialCodeField: HTMLElement | null;
  /** The parsed number, so the caller can fill {@link dialCodeField}. */
  phone: ResolvedPhone;
}

/**
 * Chooses which rendering of the number to type into `el`, and whether a
 * separate dial-code field should be filled alongside it. Returns null when
 * the stored phone couldn't be parsed (caller falls back to the raw value).
 */
export function resolvePhoneFill(el: HTMLElement, raw: string, regionHint?: string): PhoneFill | null {
  const phone = resolvePhone(raw, regionHint);
  if (!phone) return null;

  const dialCodeField = findDialCodeField(el);
  if (dialCodeField) {
    // The country code lives in its own box — this field takes just the
    // national significant number.
    return { value: phone.significant, dialCodeField, phone };
  }

  const signal = signalText(el);
  const placeholder = el.getAttribute("placeholder") ?? "";

  if (wantsNumericValue(el)) {
    // Can't type a "+" — leading-0 national digits are the only safe shape.
    return { value: phone.nationalDigits, dialCodeField: null, phone };
  }

  let value: string;
  if (/\+/.test(signal) || INTERNATIONAL_HINT_RE.test(signal) || /^\s*\\?\+|00/.test(el.getAttribute("pattern") ?? "")) {
    value = /\s/.test(placeholder) ? phone.international : phone.e164;
  } else if (/^\s*0/.test(placeholder) || NATIONAL_HINT_RE.test(signal)) {
    value = /\s/.test(placeholder) ? phone.national : phone.nationalDigits;
  } else {
    const maxLength = Number(el.getAttribute("maxlength"));
    if (maxLength && maxLength <= phone.significant.length + 2) {
      value = phone.nationalDigits;
    } else {
      value = phone.e164;
    }
  }

  return { value, dialCodeField: null, phone };
}
