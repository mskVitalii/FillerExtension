/**
 * Elements inside an open shadow root (e.g. web-component-based ATS
 * widgets) are invisible to a plain `querySelectorAll` on `document` since
 * it doesn't pierce shadow boundaries. Walks every shadow root it can reach
 * (closed roots are inaccessible to any script, extension included — no
 * fix possible there) and collects matches from each. Reused by
 * custom-questions.ts so both passes see the same set of fields. Lives on
 * its own (re-exported from engine.ts) so element-locator.ts can use it
 * without an engine ↔ locator import cycle.
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

const HONEYPOT_NAME_RE = /honeypot|hpot|\bhp[_-]|bot[_-]?trap|leave[_-]?(this[_-]?)?(blank|empty)|do[_-]?not[_-]?fill/i;

/**
 * A field no applicant can type into, so autofill must neither fill it nor ask a question
 * about it:
 *  - one marked `aria-hidden="true"` itself — a form library's hidden mirror: react-select's
 *    `<input required tabindex="-1" aria-hidden>` beside every required dropdown (Greenhouse),
 *    softgarden's `resumeUploaded`/`allowApplied` ghost inputs;
 *  - an anti-spam honeypot: a text field inside an `aria-hidden` box real users never see or
 *    reach, which bots fill and the server then rejects the submission for (rexx's
 *    `<div aria-hidden="true" tabindex="-1"><label for="website">Website</label><input
 *    name="website">` at the end of every form — its "Website" label matched the profile's
 *    website), or one named like a honeypot;
 *  - a read-only text box a widget writes for itself (softgarden's pick lists keep their choice
 *    in one). A read-only `role="combobox"` is excluded: react-select marks its own input that way.
 * A native `<select>` merely *inside* an `aria-hidden` box (under a select2 facade) is a real
 * field, filled through that facade (`select-facade.ts`).
 */
export function isGhostField(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return true;
  const textLike = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "file");
  if (textLike && el.closest('[aria-hidden="true"]')) return true;
  if (textLike && HONEYPOT_NAME_RE.test(`${el.getAttribute("name") ?? ""} ${el.id} ${el.className}`)) return true;
  const readOnly = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly;
  return readOnly && el.getAttribute("role") !== "combobox";
}
