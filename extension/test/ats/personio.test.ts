import { describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";
import { detectCheckboxes } from "@/features/autofill/checkboxes";
import { detectAts } from "@/features/autofill/ats";
import { applicant, fileSlots, loadAtsFixture, misses, reportFillRate, uploadBoth, value, type Expectation } from "./helpers";

/**
 * Personio's job page (`<company>.jobs.personio.de/job/<id>/apply`): one page, a fixed set of
 * standard fields (`first_name`, `email`, `phone`, `location`, `available_from`,
 * `salary_expectations`, `gender`, …), employer-defined `custom_attribute_<id>` fields, and one
 * file input per document category (`documents.cv`, `documents.cover-letter`,
 * `documents.employment-reference`, `documents.other`). The baseline the agent was verified on.
 */

const CV = "Ada_Lovelace_CV.pdf";
const LETTER = "Ada_Lovelace_Anschreiben.pdf";

async function fillPersonio(name: string): Promise<Record<string, string[]>> {
  loadAtsFixture("personio", name);
  await autofillDocument(applicant());
  uploadBoth();
  return fileSlots();
}

const field = (name: string) => () => value(`[name="${name}"]`);

describe("Personio", () => {
  it("is recognised by host and by its form markup", () => {
    loadAtsFixture("personio", "hwp-de");
    expect(detectAts("https://hwp.jobs.personio.de/job/2628985/apply?language=de", document)?.id).toBe("personio");
    expect(detectAts("https://careers.example.com/jobs", document)?.id).toBe("personio");
  });

  describe("hwp (German)", () => {
    it("fills name, contact and address, CV to Lebenslauf, cover letter to Andere", async () => {
      const slots = await fillPersonio("hwp-de");
      const exp: Expectation[] = [
        { label: "Vorname", actual: field("first_name"), expected: "Ada" },
        { label: "Nachname", actual: field("last_name"), expected: "Lovelace" },
        { label: "E-Mail", actual: field("email"), expected: "ada@example.com" },
        { label: "Telefon", actual: field("phone"), expected: "+49 174 5624691" },
        { label: "Postleitzahl", actual: field("custom_attribute_1078366"), expected: "10115" },
        { label: "Ort", actual: field("location"), expected: "Berlin" },
        { label: "Straße / Hausnummer", actual: field("custom_attribute_1078365"), expected: "12 Analytical Engine Ave" },
        { label: "Lebenslauf slot", actual: () => slots["documents.cv"].join(), expected: CV },
        { label: "Andere slot (cover letter)", actual: () => slots["documents.other"].join(), expected: LETTER },
      ];
      reportFillRate("personio/hwp-de", exp);
      expect(misses(exp)).toEqual([]);
      // No profile value for these; they must stay untouched.
      expect(value('[name="available_from"]')).toBe("");
      expect(value('[name="birthday"]')).toBe("");
    });

    it("asks about the start date (Verfügbar ab) as a question", async () => {
      loadAtsFixture("personio", "hwp-de");
      const questions = (await detectCustomQuestions()).map((q) => q.question);
      expect(questions).toEqual(["Verfügbar ab"]);
    });
  });

  describe("tado (English)", () => {
    it("fills contact, location, salary and pronouns; CV to CV, cover letter to Other", async () => {
      const slots = await fillPersonio("tado-en");
      const exp: Expectation[] = [
        { label: "First", actual: field("first_name"), expected: "Ada" },
        { label: "Last", actual: field("last_name"), expected: "Lovelace" },
        { label: "Email", actual: field("email"), expected: "ada@example.com" },
        { label: "Phone", actual: field("phone"), expected: "+49 174 5624691" },
        { label: "Location", actual: field("location"), expected: "Berlin" },
        { label: "Expected salary", actual: field("salary_expectations"), expected: "65000" },
        { label: "Pronouns", actual: field("custom_attribute_3216822"), expected: "they/them" },
        { label: "CV slot", actual: () => slots["documents.cv"].join(), expected: CV },
        { label: "Other slot (cover letter)", actual: () => slots["documents.other"].join(), expected: LETTER },
      ];
      reportFillRate("personio/tado-en", exp);
      expect(misses(exp)).toEqual([]);
    });

    it("asks about the start date as a question", async () => {
      loadAtsFixture("personio", "tado-en");
      const questions = (await detectCustomQuestions()).map((q) => q.question);
      expect(questions).toEqual(["Available from* (required)"]);
    });
  });

  describe("1KOMMA5° (English UI, German custom questions, four document slots)", () => {
    it("fills contact, salary and gender; each document in its own slot, references and other untouched", async () => {
      const slots = await fillPersonio("1komma5grad-en");
      const exp: Expectation[] = [
        { label: "First", actual: field("first_name"), expected: "Ada" },
        { label: "Last", actual: field("last_name"), expected: "Lovelace" },
        { label: "Email", actual: field("email"), expected: "ada@example.com" },
        { label: "Location", actual: field("location"), expected: "Berlin" },
        { label: "Phone", actual: field("phone"), expected: "+49 174 5624691" },
        { label: "Expected salary", actual: field("salary_expectations"), expected: "65000" },
        { label: "Gender", actual: () => selectedText("gender"), expected: "Female" },
        { label: "CV slot", actual: () => slots["documents.cv"].join(), expected: CV },
        { label: "Cover letter slot", actual: () => slots["documents.cover-letter"].join(), expected: LETTER },
        { label: "Employment reference slot", actual: () => slots["documents.employment-reference"].join(), expected: "" },
        { label: "Other slot", actual: () => slots["documents.other"].join(), expected: "" },
      ];
      reportFillRate("personio/1komma5grad-en", exp);
      expect(misses(exp)).toEqual([]);
    });

    it("detects the start date and every custom select as a question, with its options", async () => {
      loadAtsFixture("personio", "1komma5grad-en");
      const questions = await detectCustomQuestions();
      expect(questions.map((q) => q.question)).toEqual([
        "Available from* (required)",
        "Are you already living in Germany or are you in the process of moving to Germany within the next 3 months?* (required)",
        "How are your German language skills?* (required)",
        "Welchen höchsten schulischen Abschluss hast Du?* (required)",
        "Wie sind deine Wärmepumpen-Kenntnisse?* (required)",
      ]);
      const german = questions.find((q) => q.question.startsWith("How are your German"))!;
      expect(german.options).toContain("I speak German at B2 level (fluent)");
    });

    it("leaves gender alone when the profile has no salutation", async () => {
      loadAtsFixture("personio", "1komma5grad-en");
      await autofillDocument({ ...applicant(), salutation: "" });
      expect(selectedText("gender")).toBe("Please select");
    });
  });

  describe("ecoligo (English, CV + cover letter)", () => {
    it("fills contact, location and salary; each document in its own slot", async () => {
      const slots = await fillPersonio("ecoligo-en");
      const exp: Expectation[] = [
        { label: "First", actual: field("first_name"), expected: "Ada" },
        { label: "Last", actual: field("last_name"), expected: "Lovelace" },
        { label: "Email", actual: field("email"), expected: "ada@example.com" },
        { label: "Phone", actual: field("phone"), expected: "+49 174 5624691" },
        { label: "Location", actual: field("location"), expected: "Berlin" },
        { label: "Expected salary", actual: field("salary_expectations"), expected: "65000" },
        { label: "CV slot", actual: () => slots["documents.cv"].join(), expected: CV },
        { label: "Cover letter slot", actual: () => slots["documents.cover-letter"].join(), expected: LETTER },
      ];
      reportFillRate("personio/ecoligo-en", exp);
      expect(misses(exp)).toEqual([]);
    });
  });

  it("has no consent checkbox on any of these forms (privacy is a link; Turnstile guards submit)", () => {
    for (const name of ["hwp-de", "tado-en", "1komma5grad-en", "ecoligo-en"]) {
      loadAtsFixture("personio", name);
      expect(detectCheckboxes()).toEqual([]);
    }
  });
});

function selectedText(name: string): string {
  const select = document.querySelector<HTMLSelectElement>(`select[name="${name}"]`)!;
  return select.selectedOptions[0]?.textContent?.trim() ?? "";
}
