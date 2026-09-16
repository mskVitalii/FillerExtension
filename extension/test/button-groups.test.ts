import { beforeEach, describe, expect, it } from "vitest";
import { decomposeContainer, fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { loadFixture } from "./load-fixture";

/**
 * Ashby-style "Yes/No" questions are rendered as a pair of
 * `button[aria-pressed]` elements wired to a hidden, unlabeled checkbox —
 * not a native radio/checkbox group, so this exercises the picker's
 * toggle-button-group detection and fill path separately from
 * radio-groups.test.ts.
 */
describe("toggle-button-group picking and filling", () => {
  beforeEach(() => {
    loadFixture();
  });

  it("decomposes the Yes/No group with its question text and both options", () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="yesno-demo"]')!;
    const { picked } = decomposeContainer(container);
    expect(picked).toHaveLength(1);
    expect(picked[0].question).toBe("Will you be able to work on-site at our office in Augsburg?");
    expect(picked[0].options).toEqual(["Yes", "No"]);
  });

  it("presses the button matching the answer and leaves the other unpressed", async () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="yesno-demo"]')!;
    const { picked } = decomposeContainer(container);

    const { filled } = await fillAnswersByLocator([{ locator: picked[0].locator, answer: "Yes" }]);
    expect(filled).toBe(1);

    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
  });

  it("does not re-press an already-pressed matching button", async () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="yesno-demo"]')!;
    const noButton = container.querySelector<HTMLButtonElement>('[data-option="no"]')!;
    noButton.setAttribute("aria-pressed", "true");

    const { picked } = decomposeContainer(container);
    const { filled } = await fillAnswersByLocator([{ locator: picked[0].locator, answer: "No" }]);
    expect(filled).toBe(0);
    expect(noButton.getAttribute("aria-pressed")).toBe("true");
  });
});
