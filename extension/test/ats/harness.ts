import { autofillDocument } from "@/features/autofill/engine";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";
import { detectCheckboxes } from "@/features/autofill/checkboxes";
import { injectFileIntoPage } from "@/features/file-upload/inject-file";
import { testProfile } from "../fixtures";
import { loadAtsFixture } from "./load-ats-fixture";

/**
 * What a correct fill of one real ATS form looks like — the expected end state, written by hand
 * from the form itself for the fictional applicant in `test/fixtures.ts` (Ada Lovelace, Berlin).
 * Fields are addressed by `name` (or a CSS selector when it starts with one of `#.[`).
 *
 * Only plain DOM/engine APIs that also existed before the ATS work are used here, so the same
 * spec scores an older engine too (`fillRate`, the "before" column of the report).
 */
export interface FixtureSpec {
  file: string;
  /** Field → the value `autofillDocument` must leave in it (a `<select>`'s option *value*). */
  filled: Record<string, string>;
  /** Fields autofill must leave empty: not the applicant's own value (honeypot, academic title, a referrer's name…). */
  untouched: string[];
  /** Radio group `name` → the `value` autofill must check. */
  radios?: Record<string, string>;
  /** select widget facade → the label it must show after the fill (jQuery UI selectmenu). */
  facadeText?: Record<string, string>;
  /** Substrings of the custom questions that must be detected (each matching exactly one). */
  questions: string[];
  /** Substrings that must *not* come back as a question (a profile field, a honeypot). */
  notQuestions?: string[];
  /** Substrings of consent checkboxes `detectCheckboxes` must offer. */
  checkboxes?: string[];
  /** File inputs (`name`) each document must land in; `never` must stay empty. */
  files: { cv: string[]; coverLetter: string[]; never: string[] };
  /** Show the form's next step (concludis "Weiter") before checking `afterNextStep`. */
  nextStep?: () => void;
  afterNextStep?: { questions?: string[]; checkboxes?: string[] };
}

export function field(key: string): HTMLElement {
  const selector = /^[#.[]/.test(key) ? key : `[name="${CSS.escape(key)}"]`;
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`fixture has no field ${key}`);
  return el;
}

export function valueOf(el: HTMLElement): string {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return el.checked ? el.value : "";
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return el.value;
  return el.textContent?.trim() ?? "";
}

export function checkedRadio(name: string): string {
  return document.querySelector<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]:checked`)?.value ?? "";
}

function fileNames(input: HTMLElement): string[] {
  return Array.from((input as HTMLInputElement).files ?? []).map((f) => f.name);
}

export function pdf(name: string): File {
  return new File(["%PDF-1.4 test"], name, { type: "application/pdf" });
}

export interface FillScore {
  /** Expected outcomes reached: profile fields + salutation radios + document slots + questions + consent checkboxes. */
  ok: number;
  total: number;
  /** Values written where none belongs (`untouched`, a document in a `never` slot). */
  wrong: number;
  misses: string[];
}

/**
 * Loads the fixture, runs the whole Filler pass on it (autofill, CV then cover letter, question
 * and checkbox detection) and scores it against the spec.
 */
export async function fillRate(ats: string, spec: FixtureSpec): Promise<FillScore> {
  loadAtsFixture(ats, spec.file);
  const score: FillScore = { ok: 0, total: 0, wrong: 0, misses: [] };
  const expect = (ok: boolean, what: string) => {
    score.total++;
    if (ok) score.ok++;
    else score.misses.push(what);
  };

  await autofillDocument(testProfile());
  for (const [key, want] of Object.entries(spec.filled)) {
    const got = valueOf(field(key));
    expect(got === want, `${key}: "${got}" ≠ "${want}"`);
  }
  for (const [name, want] of Object.entries(spec.radios ?? {})) {
    const got = checkedRadio(name);
    expect(got === want, `radio ${name}: "${got}" ≠ "${want}"`);
  }
  for (const [selector, want] of Object.entries(spec.facadeText ?? {})) {
    const got = document.querySelector(selector)?.textContent?.trim() ?? "";
    expect(got === want, `${selector} shows "${got}" ≠ "${want}"`);
  }
  for (const key of spec.untouched) {
    const got = valueOf(field(key));
    if (got !== "") {
      score.wrong++;
      score.misses.push(`${key} must stay empty, got "${got}"`);
    }
  }

  // What each upload *received*: an upload widget takes the file on `change` (d.vinci sends it
  // at once and lists it), so a second document may follow the first into the same input.
  const received = new Map<string, string[]>();
  const onChange = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "file") return;
    received.set(input.name, [...(received.get(input.name) ?? []), ...fileNames(input)]);
  };
  document.addEventListener("change", onChange, true);
  injectFileIntoPage(pdf("cv.pdf"), null, "cv");
  injectFileIntoPage(pdf("cover-letter.pdf"), null, "coverLetter");
  document.removeEventListener("change", onChange, true);
  const got = (name: string) => received.get(name) ?? [];
  for (const name of spec.files.cv) expect(got(name).includes("cv.pdf"), `CV in ${name}`);
  for (const name of spec.files.coverLetter) expect(got(name).includes("cover-letter.pdf"), `cover letter in ${name}`);
  for (const name of spec.files.never) {
    if (got(name).length > 0) {
      score.wrong++;
      score.misses.push(`${name} must get no document, got ${got(name).join(", ")}`);
    }
  }
  // Any upload not named in the spec must stay empty too.
  const named = new Set([...spec.files.cv, ...spec.files.coverLetter, ...spec.files.never]);
  for (const [name, files] of received) {
    if (!named.has(name)) {
      score.wrong++;
      score.misses.push(`unexpected document in ${name}: ${files.join(", ")}`);
    }
  }

  const questions = (await detectCustomQuestions()).map((q) => q.question);
  for (const want of spec.questions) {
    expect(questions.some((q) => q.includes(want)), `question "${want}"`);
  }
  for (const unwanted of spec.notQuestions ?? []) {
    const hit = questions.find((q) => q.replace(/[:*\s]+$/, "") === unwanted);
    if (hit) {
      score.wrong++;
      score.misses.push(`"${hit}" must not be a question`);
    }
  }
  const checkboxes = detectCheckboxes().map((c) => c.label);
  for (const want of spec.checkboxes ?? []) {
    expect(checkboxes.some((label) => label.includes(want)), `checkbox "${want}"`);
  }
  if (spec.nextStep) {
    spec.nextStep();
    const later = (await detectCustomQuestions()).map((q) => q.question);
    for (const want of spec.afterNextStep?.questions ?? []) {
      expect(later.some((q) => q.includes(want)), `step 2 question "${want}"`);
    }
    const laterBoxes = detectCheckboxes().map((c) => c.label);
    for (const want of spec.afterNextStep?.checkboxes ?? []) {
      expect(laterBoxes.some((label) => label.includes(want)), `step 2 checkbox "${want}"`);
    }
  }
  return score;
}

export { loadAtsFixture };
