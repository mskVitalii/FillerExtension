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
