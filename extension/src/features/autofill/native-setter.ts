import { dateInputKindForType, coerceDateInputValue } from "@/lib/date-format";

/**
 * Sets a value the way a real user typing would, so React/Vue/Angular
 * controlled inputs pick it up (spec section 13). Plain `el.value = x`
 * does not notify the framework's internal value tracker.
 */
function setNativeInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  const previousValue = el.value;
  descriptor?.set?.call(el, value);

  // React patches `value` on the DOM node itself to keep a hidden
  // `_valueTracker` in sync with whatever it last rendered, so it can tell
  // a real edit apart from a script setting `.value` directly. Calling the
  // *native* prototype setter above (instead of `el.value = x`) is what
  // bypasses that patched setter in the first place — but it also means
  // the tracker still thinks the value is `previousValue`. Forcing it back
  // to that stale value guarantees a mismatch against the new `el.value`,
  // which is exactly the condition React's own `input` handler checks
  // before firing the component's onChange — without this, some React
  // forms silently ignore the value we just set.
  const tracker = (el as unknown as { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
  tracker?.setValue(previousValue);
}

function setNativeSelectValue(el: HTMLSelectElement, value: string): boolean {
  const normalized = value.trim().toLowerCase();
  const option = Array.from(el.options).find(
    (opt) =>
      opt.value.trim().toLowerCase() === normalized || opt.textContent?.trim().toLowerCase() === normalized,
  );
  if (!option) return false;
  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  descriptor?.set?.call(el, option.value);
  return true;
}

/**
 * A plain `Event("input")` has no `inputType`/`data` — some frameworks'
 * controlled-input handlers (and stricter validators) branch on those, so a
 * real `InputEvent` is a strictly more compatible signal than the bare
 * `Event` this used to dispatch.
 */
function dispatchChangeEvents(el: HTMLElement, options: { blur?: boolean } = {}): void {
  el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true, inputType: "insertText" }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  // Blurring right after a live-filtering widget (combobox, contenteditable
  // rich-text editor) is what closes its suggestion list / commits its
  // uncommitted state — doing that immediately after we just typed into it
  // is how those widgets end up looking "unfillable". Plain inputs are fine
  // to blur since that's the ordinary signal frameworks use to validate.
  if (options.blur !== false) el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
}

/**
 * Deprecated but still the only reliable cross-framework way to insert text
 * at the caret so contenteditable/combobox widgets (Slate, ProseMirror,
 * Draft.js, React-Select-style comboboxes) see a real `beforeinput`/`input`
 * sequence instead of a value that just appears. Falls back to a manual
 * text-node insert for the rare case `execCommand` is unsupported/no-ops.
 */
function insertTextAtCaret(el: HTMLElement, value: string): void {
  const inserted = document.execCommand("insertText", false, value);
  if (inserted && (el.textContent ?? "").includes(value)) return;

  const selection = window.getSelection();
  const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  if (range && el.contains(range.commonAncestorContainer)) {
    range.deleteContents();
    range.insertNode(document.createTextNode(value));
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  } else {
    el.textContent = value;
  }
}

/**
 * A field's own blur/change validator can call `alert`/`confirm`/`prompt`
 * on a value it doesn't like (confirmed live on a real ATS: a salary field
 * alerted "Not a number" on a range like "55-75k"). Those are synchronous
 * and block all script execution — including this content script's message
 * handler — until a person manually dismisses the native dialog, which
 * during a bulk Autofill run looks indistinguishable from the extension
 * hanging. Neutralizing them for the duration of a single fill is a
 * reasonable trade: the user already asked us to fill this field, so a
 * confirm() defaulting to "yes" and a stray alert() being swallowed is far
 * better than the whole run freezing on a page we don't control.
 */
function withoutBlockingDialogs<T>(run: () => T): T {
  const realAlert = window.alert;
  const realConfirm = window.confirm;
  const realPrompt = window.prompt;
  window.alert = () => {};
  window.confirm = () => true;
  window.prompt = () => null;
  try {
    return run();
  } finally {
    window.alert = realAlert;
    window.confirm = realConfirm;
    window.prompt = realPrompt;
  }
}

/**
 * `<input type="number">` follows the HTML value-sanitization algorithm: if
 * the string being set isn't a bare floating-point number, the browser
 * silently resets `.value` to `""` instead of throwing — so a free-text
 * answer like "€65.000" or "ca. 65,000 EUR" for a numeric question leaves
 * the field empty rather than visibly wrong. Extracts the first
 * number-looking token and normalizes thousands/decimal separators (both
 * "." and "," are used for either role depending on locale — a trailing
 * 1-2 digit group after the last separator is treated as the decimal part,
 * every other separator as a thousands grouping). Returns null when nothing
 * number-shaped could be found at all.
 */
function coerceNumberInputValue(value: string): string | null {
  const trimmed = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/-?\d[\d.,]*\d|-?\d/);
  if (!match) return null;

  const token = match[0];
  const decimals = token.match(/[.,](\d{1,2})$/)?.[1];
  const whole = (decimals ? token.slice(0, -(decimals.length + 1)) : token).replace(/[.,]/g, "");
  const normalized = decimals ? `${whole}.${decimals}` : whole;
  return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
}

/**
 * `el.type`'s exact-format coercer, or null for a type the HTML
 * value-sanitization algorithm doesn't hard-validate (`text`, `tel`,
 * `email`, `search`, `url`… all accept whatever string is set, so no
 * caller needs to guard those — same reasoning `wantsNumericValue` in
 * `field-format.ts` documents for `tel` specifically).
 */
function typedCoercer(type: string): ((raw: string) => string | null) | null {
  if (type === "number") return coerceNumberInputValue;
  const dateKind = dateInputKindForType(type);
  return dateKind ? (raw: string) => coerceDateInputValue(dateKind, raw) : null;
}

/** Fills a single detected element and fires the events controlled forms rely on. */
export function fillElement(el: HTMLElement, value: string): boolean {
  if (!value) return false;

  return withoutBlockingDialogs(() => {
    if (el instanceof HTMLInputElement) {
      const coercer = typedCoercer(el.type);
      if (coercer) {
        const coerced = coercer(value);
        if (coerced === null) return false;
        el.focus();
        setNativeInputValue(el, coerced);
        dispatchChangeEvents(el);
        return true;
      }
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.focus();
      setNativeInputValue(el, value);
      dispatchChangeEvents(el);
      return true;
    }

    if (el instanceof HTMLSelectElement) {
      const set = setNativeSelectValue(el, value);
      if (set) dispatchChangeEvents(el);
      return set;
    }

    if (el.isContentEditable) {
      el.focus();
      insertTextAtCaret(el, value);
      dispatchChangeEvents(el, { blur: false });
      return true;
    }

    if (el.getAttribute("role") === "combobox") {
      el.focus();
      el.dispatchEvent(new Event("input", { bubbles: true }));
      insertTextAtCaret(el, value);
      dispatchChangeEvents(el, { blur: false });
      return true;
    }

    return false;
  });
}
