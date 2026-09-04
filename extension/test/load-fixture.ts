import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The manual test page (`test-pages/autofill-test.html`, repo root) — the
 * one page a human tester already uses, kept in sync with it deliberately
 * rather than duplicated as separate test-only fixtures, so a fix verified
 * here is a fix verified against exactly what a manual run also exercises.
 */
const FIXTURE_PATH = path.resolve(here, "../../test-pages/autofill-test.html");

/**
 * jsdom auto-compiles an `onblur="…"` *content attribute* into a live
 * handler at parse time, bound to jsdom's own internal realm — a realm
 * `globalThis`/`window` in the test process can't reach or stub into, even
 * though they're otherwise the same object. The fixture's `salary_num`
 * field has exactly such an attribute (`onblur="return
 * validateNumeric(this);"`), whose backing function only exists in the
 * fixture's own (never-executed, since `DOMParser` parses inertly) inline
 * `<script>` — so firing that handler throws `validateNumeric is not
 * defined`. Nulling the IDL property removes jsdom's compiled handler
 * without touching the content attribute's *text*, which is all
 * `wantsNumericValue()` (`field-format.ts`) actually reads.
 */
const INLINE_HANDLER_ATTRS = ["onblur", "oninput", "onchange", "onkeyup", "onkeydown", "onkeypress"] as const;

function neutralizeInlineHandlers(root: ParentNode): void {
  for (const attr of INLINE_HANDLER_ATTRS) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      (el as unknown as Record<string, unknown>)[attr] = null;
    }
  }
}

/**
 * Replaces the current jsdom document's body with the fixture page's body.
 * Parsed via `DOMParser` (inert — no inline `<script>` runs), which is fine:
 * every test in this suite drives the real extension modules directly
 * rather than relying on the fixture's own cosmetic JS (a validator that
 * tints a field pink, a dropzone's own "Received: …" label).
 */
export function loadFixture(): void {
  const html = readFileSync(FIXTURE_PATH, "utf-8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  neutralizeInlineHandlers(document.body);
}
