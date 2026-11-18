import { beforeEach, describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { detectCustomQuestions, fillCustomQuestionAnswers } from "@/features/autofill/custom-questions";
import { detectCheckboxes } from "@/features/autofill/checkboxes";
import { decomposeContainer, fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { injectFileIntoPage } from "@/features/file-upload/inject-file";
import { testProfile } from "../fixtures";
import { loadAtsFixture, pdf, scoreFields, shownValue, textControls, type Ats, type FieldExpectation } from "./harness";

/**
 * One real ATS form snapshot and everything the extension should do on it with the fictional
 * applicant (`testProfile()`, Ada Lovelace — never real data).
 */
export interface AtsCase {
  ats: Ats;
  fixture: string;
  /** Profile fields autofill must fill, with the value the applicant should see. */
  fields: FieldExpectation[];
  /** Fields allowed to hold a value after autofill without being in `fields` (e.g. an optional duplicate). */
  tolerated?: string[];
  /** Where the CV and the cover letter must land (`null`: the form has no such input — nothing may receive it). */
  files: { cv: string; coverLetter: string | null };
  /** Text of every custom question that must be detected (substring, case-insensitive). */
  questions: string[];
  /** Questions that must NOT be offered to the AI (EEO / demographic / profile fields). */
  notQuestions: string[];
  /** Detected question → its options, for dropdown questions whose options must be revealed. */
  questionOptions?: Record<string, string[]>;
  /** One dropdown question to answer through `fillCustomQuestionAnswers`, and the value it must then show. */
  answerDropdown?: { question: string; answer: string; sel: string; want: string };
  /** Checkbox labels that must be offered to the consent pass (substring). */
  checkboxes: string[];
  /** Checkbox labels that must NOT be offered (demographic consent, survey answers). */
  notCheckboxes?: string[];
  /** Option questions (radio / button / checkbox groups) picked by their container, then answered. */
  optionQuestions?: { container: () => HTMLElement | null; question: RegExp; options: string[]; answer: string; check: () => boolean }[];
}

/** Fill-rate lines collected while the suite runs (`[fill-rate] ats/fixture ok/total`). */
export const fillRates: string[] = [];

export function describeAtsCase(c: AtsCase): void {
  describe(`${c.ats}/${c.fixture}`, () => {
    beforeEach(() => loadAtsFixture(c.ats, c.fixture));

    it("autofills every standard field with the right profile value and nothing else", async () => {
      await autofillDocument(testProfile());
      const cv = pdf("ada-lovelace-cv.pdf");
      const letter = pdf("ada-lovelace-cover-letter.pdf");
      injectFileIntoPage(cv, null, "cv");
      injectFileIntoPage(letter, null, "coverLetter");

      const score = scoreFields(c.fields);
      const fileOk = (sel: string, name: string) => document.querySelector<HTMLInputElement>(sel)?.files?.[0]?.name === name;
      let fileScore = fileOk(c.files.cv, cv.name) ? 1 : 0;
      let fileTotal = 1;
      if (c.files.coverLetter) {
        fileTotal++;
        if (fileOk(c.files.coverLetter, letter.name)) fileScore++;
      }
      fillRates.push(`[fill-rate] ${c.ats}/${c.fixture}: ${score.ok + fileScore}/${score.total + fileTotal}`);
      console.info(fillRates[fillRates.length - 1], score.misses.length ? `misses: ${score.misses.join("; ")}` : "");

      expect(score.misses).toEqual([]);

      // Nothing filled where it doesn't belong.
      const expected = new Set(
        [...c.fields.map((f) => f.sel), ...(c.tolerated ?? [])].flatMap((sel) => Array.from(document.querySelectorAll(sel))),
      );
      const stray = textControls()
        .filter((el) => !expected.has(el) && shownValue(el) !== "" && !(el instanceof HTMLSelectElement && el.selectedIndex <= 0))
        .map((el) => `${el.getAttribute("name") || el.id || el.tagName}=${JSON.stringify(shownValue(el))}`);
      expect(stray).toEqual([]);

      // Files: the right input each, and no file input got the wrong one.
      expect(fileOk(c.files.cv, cv.name)).toBe(true);
      if (c.files.coverLetter) expect(fileOk(c.files.coverLetter, letter.name)).toBe(true);
      for (const input of document.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
        const got = input.files?.[0]?.name;
        if (!got) continue;
        const want = input.matches(c.files.cv) ? cv.name : c.files.coverLetter && input.matches(c.files.coverLetter) ? letter.name : null;
        expect(`${input.id || input.name}:${got}`).toBe(`${input.id || input.name}:${want}`);
      }
    });

    it("detects every custom question, and no EEO/demographic or profile field", async () => {
      const questions = (await detectCustomQuestions()).map((q) => q.question.toLowerCase());
      const missing = c.questions.filter((q) => !questions.some((d) => d.includes(q.toLowerCase())));
      expect(missing).toEqual([]);
      const leaked = c.notQuestions.filter((q) => questions.some((d) => d.includes(q.toLowerCase())));
      expect(leaked).toEqual([]);
    });

    if (c.questionOptions) {
      it("reveals the options of dropdown questions", async () => {
        const detected = await detectCustomQuestions();
        for (const [question, options] of Object.entries(c.questionOptions!)) {
          const q = detected.find((d) => d.question.toLowerCase().includes(question.toLowerCase()));
          expect(q?.options, question).toEqual(options);
        }
      });
    }

    if (c.answerDropdown) {
      it("writes a dropdown answer by picking the option", async () => {
        const { question, answer, sel, want } = c.answerDropdown!;
        const detected = await detectCustomQuestions();
        const q = detected.find((d) => d.question.toLowerCase().includes(question.toLowerCase()));
        expect(q).toBeDefined();
        const { filled } = await fillCustomQuestionAnswers({ [q!.question]: answer });
        expect(filled).toBe(1);
        expect(shownValue(document.querySelector(sel))).toBe(want);
      });
    }

    it("offers the consent checkboxes, and not demographic ones", () => {
      const labels = detectCheckboxes().map((cb) => cb.label.toLowerCase());
      const missing = c.checkboxes.filter((l) => !labels.some((d) => d.includes(l.toLowerCase())));
      expect(missing).toEqual([]);
      const leaked = (c.notCheckboxes ?? []).filter((l) => labels.some((d) => d.includes(l.toLowerCase())));
      expect(leaked).toEqual([]);
    });

    for (const oq of c.optionQuestions ?? []) {
      it(`answers the option question ${oq.question}`, async () => {
        const container = oq.container()!;
        expect(container).not.toBeNull();
        const { picked } = decomposeContainer(container);
        const field = picked.find((p) => p.options && p.options.length > 0);
        expect(field?.question).toMatch(oq.question);
        expect(field?.options).toEqual(oq.options);
        const { filled } = await fillAnswersByLocator([{ locator: field!.locator, answer: oq.answer }]);
        expect(filled).toBe(1);
        expect(oq.check()).toBe(true);
      });
    }
  });
}
