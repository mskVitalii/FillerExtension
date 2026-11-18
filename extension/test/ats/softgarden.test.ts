import { describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";
import { detectCheckboxes } from "@/features/autofill/checkboxes";
import { decomposeContainer, fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { detectAts } from "@/features/autofill/ats";
import {
  applicant,
  fileSlots,
  loadAtsFixture,
  misses,
  qs,
  reportFillRate,
  uploadBoth,
  value,
  wireReactSelect,
  type Expectation,
} from "./helpers";

/** softgarden's application widget: three steps on one page, each revealed below the last ("zum nächsten Schritt"). */
function questionItem(text: string): HTMLElement {
  const item = Array.from(document.querySelectorAll<HTMLElement>('[class*="ApplicationFormItem"]')).find((el) =>
    el.querySelector('[class*="ApplicationQuestion__Text"]')?.textContent?.includes(text),
  );
  if (!item) throw new Error(`no question item "${text}"`);
  return item;
}

describe("softgarden (aerofit, German, all three steps)", () => {
  async function fill() {
    loadAtsFixture("softgarden", "aerofit-de-all-steps");
    const anrede = wireReactSelect(qs<HTMLInputElement>("#react-select-2-input"), ["Keine Angabe", "Herr", "Frau", "Divers"]);
    await autofillDocument(applicant());
    uploadBoth();
    return anrede;
  }

  function expectations(anrede: () => string): Expectation[] {
    const slots = fileSlots();
    return [
      { label: "Anrede", actual: anrede, expected: "Frau" },
      { label: "Vorname", actual: () => value('[name="applicationData.firstname"]'), expected: "Ada" },
      { label: "Nachname", actual: () => value('[name="applicationData.lastname"]'), expected: "Lovelace" },
      { label: "E-Mail", actual: () => value('[name="applicationData.email"]'), expected: "ada@example.com" },
      { label: "Telefon", actual: () => value('[name="applicationData.phone"]'), expected: "+491745624691" },
      // Already uploaded in step 1, so softgarden disables the tile: nothing to add.
      { label: "Lebenslauf slot (disabled after upload)", actual: () => slots["cv-file"].join(), expected: "" },
      { label: "Anhänge slot (cover letter)", actual: () => slots["attachments"].join(), expected: "Ada_Lovelace_Anschreiben.pdf" },
    ];
  }

  it("is recognised as softgarden", () => {
    loadAtsFixture("softgarden", "aerofit-de-all-steps");
    expect(detectAts("https://aerofit-loehne.career.softgarden.de/application/x/58795045/", document)?.id).toBe("softgarden");
  });

  it("fills every standard field and puts each document in its slot", async () => {
    const anrede = await fill();
    const exp = expectations(anrede);
    reportFillRate("softgarden/aerofit-de-all-steps", exp);
    expect(misses(exp)).toEqual([]);
  });

  it("writes nothing into the ghost inputs, the cover-letter text or the question answers", async () => {
    await fill();
    expect(value('[name="resumeUploaded"]')).toBe("");
    expect(value('[name="allowApplied"]')).toBe("");
    expect(value('[name="applicationData.coverLetterText"]')).toBe("");
    expect(value('[name="applicationData.answers.1.answer"]')).toBe("");
  });

  it("detects the free-text screening question, and not the ghost inputs", async () => {
    loadAtsFixture("softgarden", "aerofit-de-all-steps");
    // Radio groups come back too, with a locator (answered through `fillAnswersByLocator`).
    const questions = (await detectCustomQuestions()).filter((q) => !q.locator).map((q) => q.question);
    expect(questions).toContain("Qualifikation als Bilanzbuchhalter vorhanden");
    expect(questions.some((q) => /Lebenslauf hochladen|Option wählen/.test(q))).toBe(false);
    expect(questions).toHaveLength(1);
  });

  it("offers the ja/nein question as an option question and fills it", async () => {
    loadAtsFixture("softgarden", "aerofit-de-all-steps");
    const item = questionItem("Deutsch Kenntnisse");
    const { picked } = decomposeContainer(item);
    expect(picked).toHaveLength(1);
    expect(picked[0].question).toBe("Deutsch Kenntnisse A/2");
    expect(picked[0].options).toEqual(["ja", "nein"]);
    await fillAnswersByLocator([{ locator: picked[0].locator, answer: "ja" }]);
    expect(item.querySelector<HTMLInputElement>('input[value="ja"]')!.checked).toBe(true);
  });

  it("has no consent checkbox to decide (privacy is a link; the step ends in a captcha)", () => {
    loadAtsFixture("softgarden", "aerofit-de-all-steps");
    expect(detectCheckboxes()).toEqual([]);
  });
});

describe("softgarden (step 1 only, before the CV is uploaded)", () => {
  it("puts the CV into the CV tile and the cover letter into further attachments", () => {
    loadAtsFixture("softgarden", "aerofit-de-step1");
    uploadBoth();
    const slots = fileSlots();
    expect(slots["cv-file"]).toEqual(["Ada_Lovelace_CV.pdf"]);
    expect(slots["attachments"]).toEqual(["Ada_Lovelace_Anschreiben.pdf"]);
  });

  it("finds no question in step 1 (the 'choose an option' text belongs to a ghost input)", async () => {
    loadAtsFixture("softgarden", "aerofit-de-step1");
    expect(await detectCustomQuestions()).toEqual([]);
  });
});

describe("softgarden (own career page, English UI, all three steps)", () => {
  async function fill() {
    loadAtsFixture("softgarden", "softgarden-en-all-steps");
    await autofillDocument(applicant());
    uploadBoth();
  }

  it("fills every standard field and puts each document in its slot", async () => {
    await fill();
    const slots = fileSlots();
    const exp: Expectation[] = [
      { label: "First name", actual: () => value('[name="applicationData.firstname"]'), expected: "Ada" },
      { label: "Last name", actual: () => value('[name="applicationData.lastname"]'), expected: "Lovelace" },
      { label: "Email", actual: () => value('[name="applicationData.email"]'), expected: "ada@example.com" },
      { label: "Phone", actual: () => value('[name="applicationData.phone"]'), expected: "+491745624691" },
      { label: "CV slot (disabled after upload)", actual: () => slots["cv-file"].join(), expected: "" },
      { label: "Attachments slot (cover letter)", actual: () => slots["attachments"].join(), expected: "Ada_Lovelace_Anschreiben.pdf" },
    ];
    reportFillRate("softgarden/softgarden-en-all-steps", exp);
    expect(misses(exp)).toEqual([]);
  });

  it("never types into a pick list's hidden input", async () => {
    await fill();
    expect(value('input[name="applicationData.answers.1.answer"]')).toBe("");
    expect(value('input[name="applicationData.preferredJobLocations.0"]')).toBe("");
  });

  it("detects the start-date question and the source dropdown as questions, not the pick lists' hidden inputs", async () => {
    loadAtsFixture("softgarden", "softgarden-en-all-steps");
    const questions = (await detectCustomQuestions()).map((q) => q.question);
    expect(questions).toContain("Wann ist dein frühestmöglicher Eintrittstermin?");
    expect(questions).toContain("How did you find this job?");
    expect(questions).toHaveLength(2);
  });

  it("offers each pick list (button group) as an option question and fills it by clicking", async () => {
    loadAtsFixture("softgarden", "softgarden-en-all-steps");
    const item = questionItem("SaaS-Vertriebs Erfahrung");
    const clicked: string[] = [];
    item.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => clicked.push(b.textContent!.trim())));
    const { picked } = decomposeContainer(item);
    expect(picked).toHaveLength(1);
    expect(picked[0].question).toBe("Wie lange ist deine SaaS-Vertriebs Erfahrung?");
    expect(picked[0].options).toEqual(["Bis zu 2 Jahre", "2 bis 4 Jahre", "Mehr als 4 Jahre"]);
    await fillAnswersByLocator([{ locator: picked[0].locator, answer: "2 bis 4 Jahre" }]);
    expect(clicked).toEqual(["2 bis 4 Jahre"]);
  });
});
