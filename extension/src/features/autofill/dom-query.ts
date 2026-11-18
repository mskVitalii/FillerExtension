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

/**
 * A field no applicant can type into, so autofill must neither fill it nor ask a question
 * about it: an input marked `aria-hidden="true"` itself (a form library's hidden mirror, e.g.
 * softgarden's `resumeUploaded`/`allowApplied` ghost inputs), or a read-only text box a widget
 * writes for itself (softgarden's pick lists keep their choice in one). A read-only
 * `role="combobox"` is excluded: react-select marks its own input that way.
 */
export function isGhostField(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return true;
  const readOnly = (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.readOnly;
  return readOnly && el.getAttribute("role") !== "combobox";
}
