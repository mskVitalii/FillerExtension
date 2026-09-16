import { beforeEach, describe, expect, it } from "vitest";
import { decomposeContainer, fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { loadFixture } from "./load-fixture";

/**
 * LinkedIn's Easy Apply modal has two markup quirks the other ATS fixtures
 * don't: a free-text field labelled only via `aria-label` (no `<label>`, no
 * `name`), and a Yes/No radio group built from `[role="radio"]` rows whose
 * `<label for=…>` is empty — the visible "Yes"/"No" text sits in a sibling
 * div two levels up, and the group's own question `<p>` sits *outside* the
 * `<fieldset role="radiogroup">` entirely, as its preceding sibling.
 */
describe("LinkedIn Easy Apply-style picking and filling", () => {
  beforeEach(() => {
    loadFixture();
  });

  it("reads the aria-label-only text field as its own question", () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="linkedin-easyapply-demo"]')!;
    const { picked } = decomposeContainer(container);

    const yearsField = picked.find((p) => p.question.includes("PostgreSQL"));
    expect(yearsField).toBeDefined();
    expect(yearsField?.question).toBe("How many years of work experience do you have with PostgreSQL?");
    expect(yearsField?.confident).toBe(true);
  });

  it("finds the radio group's question outside the fieldset and each option's real Yes/No text (not the input's default value)", () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="linkedin-easyapply-demo"]')!;
    const { picked } = decomposeContainer(container);

    const commute = picked.find((p) => p.question.includes("commuting"));
    expect(commute).toBeDefined();
    expect(commute?.question).toBe("Are you comfortable commuting to this job's location?");
    expect(commute?.options).toEqual(["Yes", "No"]);
  });

  it("selects the correct radio option by its Yes/No text, not both/neither", async () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="linkedin-easyapply-demo"]')!;
    const { picked } = decomposeContainer(container);
    const commute = picked.find((p) => p.question.includes("commuting"))!;

    const { filled } = await fillAnswersByLocator([{ locator: commute.locator, answer: "No" }]);
    expect(filled).toBe(1);

    expect(document.getElementById("li-commute-no")).toHaveProperty("checked", true);
    expect(document.getElementById("li-commute-yes")).toHaveProperty("checked", false);
  });
});
