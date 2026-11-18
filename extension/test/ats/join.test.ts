import { describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";
import { detectCheckboxes } from "@/features/autofill/checkboxes";
import { decomposeContainer, fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { detectAts } from "@/features/autofill/ats";
import { applicant, fileSlots, loadAtsFixture, misses, qs, reportFillRate, uploadBoth, value, type Expectation } from "./helpers";

/**
 * join.com: "Jetzt bewerben" leads to `/companies/<c>/<jobId>/apply/authentication`, an email
 * gate (real snapshot), then a step-by-step wizard behind a candidate account. The wizard
 * fixtures are reconstructions (see their header comment), so these tests pin the engine's
 * behaviour on JOIN's field shapes and wording, not a byte-exact page.
 */

describe("join.com", () => {
  it("is recognised on its apply flow and nowhere else on join.com", () => {
    loadAtsFixture("join", "softgate-de-authentication");
    const adapter = detectAts("https://join.com/companies/softgate/16863784/apply/authentication", document);
    expect(adapter?.id).toBe("join");
    expect(detectAts("https://join.com/companies/softgate", document)?.id).not.toBe("join");
  });

  it("knows the wizard's continue button, so a multi-step driver can advance it", () => {
    loadAtsFixture("join", "wizard-personal-information.reconstructed");
    const adapter = detectAts("https://join.com/companies/softgate/16863784/apply/personal-information", document)!;
    expect(adapter.nextStep?.(document)).toBe(qs('[data-testid="ContinueButton"]'));
    expect(adapter.submitButton?.(document) ?? null).toBeNull();
  });

  it("authentication step: types only the email", async () => {
    loadAtsFixture("join", "softgate-de-authentication");
    await autofillDocument(applicant());
    expect(value("#email")).toBe("ada@example.com");
  });

  it("personal information step: names, country of residence, phone with its dial-code select, CV", async () => {
    loadAtsFixture("join", "wizard-personal-information.reconstructed");
    await autofillDocument(applicant());
    uploadBoth();
    const slots = fileSlots();
    const exp: Expectation[] = [
      { label: "Vorname", actual: () => value("#firstName"), expected: "Ada" },
      { label: "Nachname", actual: () => value("#lastName"), expected: "Lovelace" },
      { label: "Wohnsitzland", actual: () => value("#countryOfResidence"), expected: "DE" },
      { label: "Ländervorwahl", actual: () => value('[name="phoneCountryCode"]'), expected: "+49" },
      { label: "Telefonnummer", actual: () => value("#phone"), expected: "1745624691" },
      { label: "CV slot", actual: () => slots["cv"].join(), expected: "Ada_Lovelace_CV.pdf" },
    ];
    reportFillRate("join/wizard-personal-information", exp);
    expect(misses(exp)).toEqual([]);
    // JOIN fills the account email itself and locks it.
    expect(value("#email")).toBe("");
  });

  it("application details step: cover letter upload, salary as a bare number, LinkedIn", async () => {
    loadAtsFixture("join", "wizard-application-details.reconstructed");
    await autofillDocument(applicant());
    uploadBoth();
    const slots = fileSlots();
    const exp: Expectation[] = [
      { label: "Anschreiben slot", actual: () => slots["coverLetter"].join(), expected: "Ada_Lovelace_Anschreiben.pdf" },
      { label: "Gehaltsvorstellungen", actual: () => value("#salaryExpectation"), expected: "65000" },
      { label: "LinkedIn", actual: () => value('[name="professionalLinks.0"]'), expected: "https://linkedin.com/in/ada-lovelace" },
    ];
    reportFillRate("join/wizard-application-details", exp);
    expect(misses(exp)).toEqual([]);
  });

  it("application details step: the screening number question is a question; start date and yes/no are option questions", async () => {
    loadAtsFixture("join", "wizard-application-details.reconstructed");
    // Radio groups come back too, with a locator (answered through `fillAnswersByLocator`).
    const questions = (await detectCustomQuestions()).filter((q) => !q.locator);
    expect(questions.map((q) => q.question)).toEqual(["Wie viele Jahre Berufserfahrung haben Sie als Consultant?"]);
    expect(questions[0].numeric).toBe(true);

    const start = qs('[aria-labelledby="startAvailability-label"]');
    const { picked } = decomposeContainer(start);
    expect(picked[0].question).toBe("Ab wann können Sie anfangen?");
    expect(picked[0].options).toEqual([
      "Sofort",
      "Innerhalb von 2 Wochen",
      "Innerhalb von 1 Monat",
      "Innerhalb von 2 Monaten",
      "Innerhalb von 3 Monaten",
      "Mehr als 3 Monate",
    ]);
    await fillAnswersByLocator([{ locator: picked[0].locator, answer: "Innerhalb von 3 Monaten" }]);
    expect(start.querySelector<HTMLInputElement>('input[value="THREE_MONTHS"]')!.checked).toBe(true);
  });

  it("the 'use this CV by default' box is offered to the checkbox decision, nothing else", () => {
    loadAtsFixture("join", "wizard-personal-information.reconstructed");
    expect(detectCheckboxes().map((c) => c.name)).toEqual(["useAsDefaultCv"]);
  });
});
