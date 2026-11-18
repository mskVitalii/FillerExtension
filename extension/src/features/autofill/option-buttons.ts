/**
 * Buttons that are the options of one choice question, rather than actions:
 *  - toggle buttons with `aria-pressed` (Ashby's / Greenhouse's Yes/No widgets);
 *  - a "pick list": plain `<button type="button">` rows whose wrapper sits beside the input that
 *    holds the chosen value (softgarden: `<div name=…><input readonly name=…><div>buttons</div></div>`).
 * Shared by the picker (`pick-questions.ts`) and the locator (`element-locator.ts`), so both see
 * the same groups.
 */

const PRESSED_SELECTOR = 'button[aria-pressed], [role="button"][aria-pressed]';

/** Candidates for `querySelectorAll`; narrow them with `isOptionButton`. */
export const OPTION_BUTTON_CANDIDATES = `${PRESSED_SELECTOR}, button[type="button"]`;

export function isOptionButton(el: Element): el is HTMLElement {
  if (el.matches(PRESSED_SELECTOR)) return true;
  if (!(el instanceof HTMLButtonElement) || el.type !== "button") return false;
  const holder = el.parentElement?.parentElement;
  if (!holder) return false;
  return Array.from(holder.children).some(
    (child) => child instanceof HTMLInputElement && child.name !== "" && (child.type === "hidden" || child.readOnly),
  );
}

/** Option buttons inside `root`. */
export function optionButtonsIn(root: ParentNode): HTMLElement[] {
  return Array.from(root.querySelectorAll(OPTION_BUTTON_CANDIDATES)).filter(isOptionButton);
}
