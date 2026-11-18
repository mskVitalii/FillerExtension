import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Every fixture of one ATS (`test/ats/<ats>/*.html`), by file name. */
export function atsFixtures(ats: string): string[] {
  return readdirSync(path.join(here, ats))
    .filter((f) => f.endsWith(".html"))
    .sort();
}

/**
 * Loads a sanitized snapshot of a real application form (`test/ats/<ats>/<file>`) into jsdom's
 * document. The snapshots were taken from the live pages after rendering, with scripts, styles,
 * tracking and every element the page didn't render removed (a hidden `<input type="file">`
 * behind a styled button is kept, marked `data-fx-hidden`), so "in the DOM" here means "visible
 * on the real page". Parsed inertly via DOMParser, like the manual test page.
 */
export function loadAtsFixture(ats: string, file: string, url?: string): void {
  const html = readFileSync(path.join(here, ats, file), "utf-8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.title = parsed.title;
  document.documentElement.lang = parsed.documentElement.lang;
  document.body.innerHTML = parsed.body.innerHTML;
  if (url) window.history.replaceState(null, "", url);
}
