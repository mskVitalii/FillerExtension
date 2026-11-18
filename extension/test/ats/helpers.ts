import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { injectFileIntoPage, type FileKind } from "@/features/file-upload/inject-file";
import { testProfile } from "../fixtures";
import type { Profile } from "@/types/profile";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Loads `test/ats/<ats>/<name>.html` — a sanitized snapshot of a real ATS
 * application form (see the comment at the top of each file for its source
 * URL and what was stripped) — into jsdom's document, the same inert way
 * `load-fixture.ts` loads the manual test page.
 */
export function loadAtsFixture(ats: string, name: string): void {
  const html = readFileSync(path.join(here, ats, `${name}.html`), "utf-8");
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
}

/** The shared fictional applicant, with a salutation the German forms have to translate. */
export function applicant(): Profile {
  return { ...testProfile(), salutation: "Ms" };
}

export function qs<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`fixture has no ${selector}`);
  return el;
}

export function value(selector: string): string {
  return (qs(selector) as HTMLInputElement).value;
}

/**
 * Gives a react-select snapshot its menu back: the static fixture keeps the
 * Control, value container and the combobox `<input>`, but the menu only
 * exists while React renders it. Mirrors what react-select does on a real
 * page (and what `react-select-profile.test.ts` models): mousedown on the
 * Control renders `role="option"` rows, clicking one shows it as the
 * single value.
 */
export function wireReactSelect(input: HTMLInputElement, options: string[]): () => string {
  const control = input.closest<HTMLElement>('[class*="__control"]')!;
  const container = control.querySelector<HTMLElement>('[class*="value-container"]')!;
  const root = control.parentElement!;
  control.addEventListener("mousedown", () => {
    if (root.querySelector('[role="listbox"]')) return;
    const list = document.createElement("div");
    list.id = `${input.id}-listbox`.replace("-input", "");
    list.setAttribute("role", "listbox");
    input.setAttribute("aria-controls", list.id);
    input.setAttribute("aria-expanded", "true");
    options.forEach((text, i) => {
      const option = document.createElement("div");
      option.id = `${input.id.replace("-input", "")}-option-${i}`;
      option.setAttribute("role", "option");
      option.textContent = text;
      option.addEventListener("click", () => {
        container.querySelector('[class*="placeholder"], [class*="single-value"]')?.remove();
        const shown = document.createElement("div");
        shown.className = "Select__single-value";
        shown.textContent = text;
        container.prepend(shown);
        list.remove();
        input.setAttribute("aria-expanded", "false");
      });
      list.append(option);
    });
    root.append(list);
  });
  return () => container.querySelector('[class*="single-value"]')?.textContent ?? "";
}

export function cvFile(): File {
  return new File(["%PDF-1.4 Ada Lovelace CV"], "Ada_Lovelace_CV.pdf", { type: "application/pdf" });
}

export function coverLetterFile(): File {
  return new File(["%PDF-1.4 Ada Lovelace cover letter"], "Ada_Lovelace_Anschreiben.pdf", { type: "application/pdf" });
}

/** Uploads the CV and the cover letter the way the Side Panel does (one `UPLOAD_FILE` per kind). */
export function uploadBoth(): void {
  const kinds: [File, FileKind][] = [
    [cvFile(), "cv"],
    [coverLetterFile(), "coverLetter"],
  ];
  for (const [file, kind] of kinds) injectFileIntoPage(file, null, kind);
}

/** Names of the files now in every `<input type="file">`, keyed by its `name`. */
export function fileSlots(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    out[input.name || input.id] = Array.from(input.files ?? []).map((f) => f.name);
  }
  return out;
}

export interface Expectation {
  /** What the field is, for the fill-rate report. */
  label: string;
  actual: () => string;
  expected: string;
}

/** Checks every expectation and returns the ones that don't hold — one assertion lists them all. */
export function misses(expectations: Expectation[]): string[] {
  return expectations
    .filter((e) => e.actual() !== e.expected)
    .map((e) => `${e.label}: expected ${JSON.stringify(e.expected)}, got ${JSON.stringify(e.actual())}`);
}

/**
 * `FILL_RATE=1 npx vitest run test/ats` prints "<fixture>: filled correctly / total"
 * per fixture — the number the ATS report quotes.
 */
export function reportFillRate(fixture: string, expectations: Expectation[]): void {
  if (!process.env.FILL_RATE) return;
  const ok = expectations.length - misses(expectations).length;
  console.log(`[fill-rate] ${fixture}: ${ok}/${expectations.length}`);
}
