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

const HONEYPOT_NAME_RE = /honeypot|hpot|\bhp[_-]|bot[_-]?trap|beecatcher|leave[_-]?(this[_-]?)?(blank|empty)|do[_-]?not[_-]?fill/i;
/** What a honeypot tells people who do see it: Workday's "This input is for robots only, do not enter if you're human." */
const HONEYPOT_TEXT_RE = /for robots only|(only|just) for (bots|robots)|do not (enter|fill|type)[^.]{0,30}(if you('re| are)|human)|if you('re| are) (a )?human|leave (this )?(field )?(blank|empty)|(dieses|das) feld (bitte )?leer (lassen|bleiben)|nicht ausfüllen/i;

/** The field's own label text: its <label>s, aria-label and placeholder — never the text around it. */
function ownLabelText(el: HTMLInputElement | HTMLTextAreaElement): string {
  const labels = Array.from(el.labels ?? []).map((l) => l.textContent ?? "");
  return [...labels, el.getAttribute("aria-label") ?? "", el.getAttribute("placeholder") ?? ""].join(" ");
}

/**
 * An anti-spam honeypot by its name or its own label (not by an aria-hidden box: see `isGhostField`).
 * Filling one gets the application thrown away as a bot's.
 */
export function isHoneypot(el: HTMLElement): boolean {
  const textLike = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "file");
  if (!textLike) return false;
  if (HONEYPOT_NAME_RE.test(`${el.getAttribute("name") ?? ""} ${el.id} ${el.className} ${el.getAttribute("data-automation-id") ?? ""}`)) return true;
  return HONEYPOT_TEXT_RE.test(ownLabelText(el));
}

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
 *    website), or one named like a honeypot (Workday's `data-automation-id="beecatcher"`), or one
 *    whose own label tells humans to leave it alone ("This input is for robots only, do not enter
 *    if you're human.");
 *  - a read-only text box a widget writes for itself (softgarden's pick lists keep their choice
 *    in one). A read-only `role="combobox"` is excluded: react-select marks its own input that way.
 * A native `<select>` merely *inside* an `aria-hidden` box (under a select2 facade) is a real
 * field, filled through that facade (`select-facade.ts`).
 */
export function isGhostField(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return true;
  const textLike = el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type !== "file");
  if (textLike && el.closest('[aria-hidden="true"]')) return true;
  if (isHoneypot(el)) return true;
  const readOnly = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly;
  return readOnly && el.getAttribute("role") !== "combobox";
}
