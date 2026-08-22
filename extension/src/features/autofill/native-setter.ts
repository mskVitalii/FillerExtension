/**
 * Sets a value the way a real user typing would, so React/Vue/Angular
 * controlled inputs pick it up (spec section 13). Plain `el.value = x`
 * does not notify the framework's internal value tracker.
 */
function setNativeInputValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(el, value);
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

function dispatchChangeEvents(el: HTMLElement): void {
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
}

/** Fills a single detected element and fires the events controlled forms rely on. */
export function fillElement(el: HTMLElement, value: string): boolean {
  if (!value) return false;

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
    document.execCommand("insertText", false, value);
    dispatchChangeEvents(el);
    return true;
  }

  if (el.getAttribute("role") === "combobox") {
    el.focus();
    el.dispatchEvent(new Event("input", { bubbles: true }));
    document.execCommand("insertText", false, value);
    dispatchChangeEvents(el);
    return true;
  }

  return false;
}
