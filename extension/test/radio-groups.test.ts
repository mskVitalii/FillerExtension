import { beforeEach, describe, expect, it } from "vitest";
import { decomposeContainer, fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { loadFixture } from "./load-fixture";

/**
 * The "Radio-group questions" section of the manual test page is explicitly
 * "use Pick fields on page" — this exercises exactly that pipeline
 * (decompose the picked block into fields + questions, then write an
 * answer back by locator) without needing to drive the visual picker's
 * mouse/keyboard overlay.
 */
describe("radio-group picking and filling", () => {
  beforeEach(() => {
    loadFixture();
  });

  it("decomposes the pronouns group into its 4 options with the right question text", () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="pronouns-demo"]')!;
    const { picked } = decomposeContainer(container);
    expect(picked).toHaveLength(1);
    expect(picked[0].question).toBe("Preferred pronouns (Optional)");
    expect(picked[0].options).toEqual(["he/him", "she/her", "they/them", "I prefer to use different pronouns"]);
  });

  it("fills the option matching the given answer, and only that one", () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="pronouns-demo"]')!;
    const { picked } = decomposeContainer(container);

    const filled = fillAnswersByLocator([{ locator: picked[0].locator, answer: "they/them" }]);
    expect(filled).toBe(1);

    const radios = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const checked = radios.filter((r) => r.checked);
    expect(checked).toHaveLength(1);
    expect(checked[0].id).toBe("pron-2");
  });

  it("decomposes and fills the hybrid-working group independently of the pronouns group", () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="hybrid-demo"]')!;
    const { picked } = decomposeContainer(container);
    expect(picked).toHaveLength(1);
    expect(picked[0].options).toEqual([
      "3+ days per week in the office",
      "2 days per week in the office",
      "1 day per week in the office",
      "Fully remote only",
      "Other (see 'Other considerations' below)",
    ]);

    fillAnswersByLocator([{ locator: picked[0].locator, answer: "2 days per week in the office" }]);
    expect(document.getElementById("hyb-1")).toHaveProperty("checked", true);
    expect(document.getElementById("hyb-0")).toHaveProperty("checked", false);
  });

  it("picking the wrapper that holds both demo blocks in one go finds both groups", () => {
    // The two `[data-field-path]` divs share one immediate parent in the
    // fixture — picking that parent is what "one click captures the whole
    // section" looks like in the real visual picker.
    const container = document.querySelector<HTMLElement>('[data-field-path="pronouns-demo"]')!.parentElement!;
    expect(container.querySelector('[data-field-path="hybrid-demo"]')).not.toBeNull();

    const { picked } = decomposeContainer(container);
    expect(picked.filter((p) => p.options && p.options.length > 0)).toHaveLength(2);
  });
});
