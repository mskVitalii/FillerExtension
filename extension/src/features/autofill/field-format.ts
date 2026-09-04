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

function optionStrings(select: HTMLSelectElement): string[] {
  return Array.from(select.options).map((o) => `${o.value} ${o.textContent ?? ""}`.trim());
}

const MAX_GROUP_LEVELS = 6;
/** A "phone row" is the field itself plus a couple of companions (dial code, extension) — not a whole section. */
const MAX_GROUP_SIZE = 3;

/**
 * A sibling field that takes the country calling code on its own — either
 * labelled as one, or a `<select>` whose options are mostly `+49` / `0049` /
 * `Germany (+49)` shaped. Climbs from `phoneEl` one ancestor at a time and
 * stops at the *first* ancestor that only wraps a handful of fields — a
 * `<form>` or a whole fieldset routinely wraps several unrelated phone-shaped
 * demo/example fields too, and blindly scanning that far pairs a phone field
 * with a dial-code select that actually belongs to a different field
 * entirely (confirmed against `test-pages/autofill-test.html`, which has
 * several standalone phone inputs sharing a fieldset with the one real
 * dial-code select).
 */
export function findDialCodeField(phoneEl: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = phoneEl.parentElement;
  for (let level = 0; node && level < MAX_GROUP_LEVELS; level++, node = node.parentElement) {
    const candidates = Array.from(node.querySelectorAll("input, select")).filter(
      (el): el is HTMLElement => isFieldElement(el) && el !== phoneEl,
    );
    if (candidates.length === 0 || candidates.length > MAX_GROUP_SIZE) continue;

    const bySignal = candidates.find((el) => DIAL_CODE_SIGNAL_RE.test(signalText(el)));
    if (bySignal) return bySignal;

    const byShape = candidates.find((el) => {
      if (!(el instanceof HTMLSelectElement) || el.options.length < 2) return false;
      const opts = optionStrings(el).filter((s) => s);
      const dialShaped = opts.filter((s) => /(\+\d{1,4})|^00\d{1,4}$|^\+?\d{1,4}$/.test(s));
      return dialShaped.length / opts.length >= 0.6 && opts.some((s) => s.includes("+"));
    });
    if (byShape) return byShape;

    if (node.tagName === "FORM") break;
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
 *
 * Deliberately a two-way choice, not three: whether the country code is
 * *separate or not* is the one thing the page actually tells us for sure (a
 * sibling dial-code field, or none). Guessing a bare "leading 0" national
 * form from placeholder text for a lone field used to misfire on unrelated
 * demo/example fields — a single field always gets the full number with its
 * country code; a country code only ever gets dropped when a dedicated
 * dial-code field is taking it instead.
 */
export function resolvePhoneFill(el: HTMLElement, raw: string, regionHint?: string): PhoneFill | null {
  const phone = resolvePhone(raw, regionHint);
  if (!phone) return null;

  const dialCodeField = findDialCodeField(el);
  if (dialCodeField) {
    // The country code lives in its own box — this field takes just the
    // national significant number (no leading 0, no country code).
    return { value: phone.significant, dialCodeField, phone };
  }

  if (wantsNumericValue(el)) {
    // Can't type a "+" — digits only, but still with the country code
    // (e.g. "491701234567"), since there's no separate field taking it.
    return { value: `${phone.callingCode}${phone.significant}`, dialCodeField: null, phone };
  }

  const placeholder = el.getAttribute("placeholder") ?? "";
  const value = /\s/.test(placeholder) ? phone.international : phone.e164;
  return { value, dialCodeField: null, phone };
}
