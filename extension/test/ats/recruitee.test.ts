import { describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";
import { detectCheckboxes } from "@/features/autofill/checkboxes";
import { decomposeContainer, fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { detectAts } from "@/features/autofill/ats";
import { applicant, fileSlots, loadAtsFixture, misses, reportFillRate, uploadBoth, value, type Expectation } from "./helpers";

/**
 * Recruitee (Tellent) offer pages, `/o/<slug>/c/new`, on `<company>.recruitee.com` or a custom
 * careers domain: one full-name field, email, a phone input with its own dial-code combobox
 * (`+49` typed in by default), CV and cover-letter files, then "open questions" with
 * `candidate.openQuestionAnswers.<id>.*` names (text, textarea, yes/no radios, single and
 * multiple choice, file uploads).
 */

const CV = "Ada_Lovelace_CV.pdf";
const LETTER = "Ada_Lovelace_Anschreiben.pdf";
const field = (name: string) => () => value(`[name="${name}"]`);
const compactPhone = (name: string) => () => value(`[name="${name}"]`).replace(/\s/g, "");

function questionBlock(text: string): HTMLElement {
  const legend = Array.from(document.querySelectorAll("legend")).find((l) => l.textContent?.includes(text));
  if (!legend) throw new Error(`no question "${text}"`);
  return legend.closest("fieldset")!.parentElement!;
}

describe("Recruitee", () => {
  it("is recognised by host and, on a custom careers domain, by its form", () => {
    loadAtsFixture("recruitee", "crazygames-en");
    expect(detectAts("https://jobs.crazygames.com/o/remote-senior-liveops-developer-mobile-games/c/new", document)?.id).toBe("recruitee");
    loadAtsFixture("recruitee", "caritas-de");
    expect(detectAts("https://caritasgesundheitberlinggmbh.recruitee.com/o/x/c/new", document)?.id).toBe("recruitee");
  });

  describe("Caritas (German, cover letter + certificate uploads)", () => {
    it("fills name, email and phone; CV and cover letter into their own slots, Zeugnisse untouched", async () => {
      loadAtsFixture("recruitee", "caritas-de");
      await autofillDocument(applicant());
      uploadBoth();
      const slots = fileSlots();
      const exp: Expectation[] = [
        { label: "Vor- und Nachname", actual: field("candidate.name"), expected: "Ada Lovelace" },
        { label: "E-Mail-Adresse", actual: field("candidate.email"), expected: "ada@example.com" },
        { label: "Telefonnummer", actual: compactPhone("candidate.phone"), expected: "+491745624691" },
        { label: "Lebenslauf slot", actual: () => slots["candidate.cv"].join(), expected: CV },
        { label: "Anschreiben slot", actual: () => slots["candidate.coverLetterFile"].join(), expected: LETTER },
        { label: "open question: Anschreiben upload", actual: () => slots["candidate.openQuestionAnswers.7708046.file"].join(), expected: "" },
        { label: "open question: Zeugnisse", actual: () => slots["candidate.openQuestionAnswers.7708047.file"].join(), expected: "" },
        { label: "open question: Zeugnisse (2)", actual: () => slots["candidate.openQuestionAnswers.7708048.file"].join(), expected: "" },
      ];
      reportFillRate("recruitee/caritas-de", exp);
      expect(misses(exp)).toEqual([]);
    });

    it("has no text question and no checkbox to decide", async () => {
      loadAtsFixture("recruitee", "caritas-de");
      expect(await detectCustomQuestions()).toEqual([]);
      expect(detectCheckboxes()).toEqual([]);
    });
  });

  describe("CrazyGames (English, many open questions)", () => {
    it("fills name, email and phone (country code from the profile, not the page's Belgian default)", async () => {
      loadAtsFixture("recruitee", "crazygames-en");
      await autofillDocument(applicant());
      uploadBoth();
      const slots = fileSlots();
      const exp: Expectation[] = [
        { label: "Full name", actual: field("candidate.name"), expected: "Ada Lovelace" },
        { label: "Email address", actual: field("candidate.email"), expected: "ada@example.com" },
        { label: "Phone number", actual: compactPhone("candidate.phone"), expected: "+491745624691" },
        { label: "CV slot", actual: () => slots["candidate.cv"].join(), expected: CV },
        { label: "Cover letter slot", actual: () => slots["candidate.coverLetterFile"].join(), expected: LETTER },
      ];
      reportFillRate("recruitee/crazygames-en", exp);
      expect(misses(exp)).toEqual([]);
      // "Where are you located?" is a question for the AI, not the profile's city.
      expect(value('[name="candidate.openQuestionAnswers.7629862.content"]')).toBe("");
    });

    it("detects every free-text open question", async () => {
      loadAtsFixture("recruitee", "crazygames-en");
      // Radio groups come back too, with a locator (answered through `fillAnswersByLocator`).
      const questions = (await detectCustomQuestions()).filter((q) => !q.locator).map((q) => q.question.replace(/\s*\*$/, ""));
      expect(questions).toEqual([
        "Where are you located?",
        "Link one live mobile game you worked on, then tell us your role and the update cadence you ran on it. Three sentences maximum.",
        "When can you start working?",
        "What is the salary range that you're looking for? (In Euros - Monthly salary range)",
        "Anything else you want us to look at? Portfolio, GitHub, a game you're proud of.",
        "Tell us briefly what attracts you in this job opportunity",
      ]);
    });

    it("never treats a 'select all that apply' answer option as a consent checkbox", () => {
      loadAtsFixture("recruitee", "crazygames-en");
      expect(detectCheckboxes()).toEqual([]);
    });

    it("offers the yes/no, single- and multi-choice questions as option questions and fills them", async () => {
      loadAtsFixture("recruitee", "crazygames-en");
      const years = decomposeContainer(questionBlock("How many years")).picked;
      expect(years).toHaveLength(1);
      expect(years[0].options).toEqual(["None", "Less than 1 year", "1-2 years", "2-4 years", "4+ years"]);

      const tz = decomposeContainer(questionBlock("time zone")).picked;
      expect(tz[0].options).toEqual(["Yes", "No"]);

      const tech = decomposeContainer(questionBlock("production experience with")).picked;
      expect(tech).toHaveLength(1);
      expect(tech[0].multi).toBe(true);
      expect(tech[0].options).toContain("JavaScript / TypeScript");

      await fillAnswersByLocator([
        { locator: years[0].locator, answer: "2-4 years" },
        { locator: tz[0].locator, answer: "Yes" },
        { locator: tech[0].locator, answer: "JavaScript / TypeScript | Backend services for live games" },
      ]);
      const checked = (name: string) =>
        Array.from(document.querySelectorAll<HTMLInputElement>(`[name="${name}"]`))
          .filter((i) => i.checked)
          .map((i) => i.value);
      expect(checked("candidate.openQuestionAnswers.7629864.content")).toEqual(["2-4 years"]);
      expect(checked("candidate.openQuestionAnswers.7629863.flag")).toEqual(["true"]);
      expect(checked("candidate.openQuestionAnswers.7629867.multiContent")).toEqual([
        "JavaScript / TypeScript",
        "Backend services for live games",
      ]);
    });
  });
});
