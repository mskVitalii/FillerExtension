import { beforeEach, describe, expect, it } from "vitest";
import { decomposeContainer, fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { loadFixture } from "./load-fixture";

/**
 * Ashby-style "select all that apply" checkbox groups have no shared
 * `name` to group by (each option is individually named after its own
 * value, e.g. `name="TypeScript"`), and the AI's answer can name more than
 * one option — this exercises the picker's checkbox-group detection and
 * multi-select fill path separately from radio-groups.test.ts and
 * button-groups.test.ts.
 */
describe("checkbox-group picking and filling", () => {
  beforeEach(() => {
    loadFixture();
  });

  it("decomposes the tech-stack group with its question text, all 5 options, and multi: true", () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="techstack-demo"]')!;
    const { picked } = decomposeContainer(container);
    expect(picked).toHaveLength(1);
    expect(picked[0].question).toBe("Which of the following technologies do you have experience with? (Select all that apply)");
    expect(picked[0].options).toEqual(["TypeScript", "React.js", "Node.js", "GraphQL", "PostgreSQL"]);
    expect(picked[0].multi).toBe(true);
  });

  it("checks every option named in a ' | '-separated answer, and only those", async () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="techstack-demo"]')!;
    const { picked } = decomposeContainer(container);

    const { filled } = await fillAnswersByLocator([
      { locator: picked[0].locator, answer: "TypeScript | React.js | Node.js" },
    ]);
    expect(filled).toBe(1);

    const checked = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .filter((cb) => cb.checked)
      .map((cb) => cb.name);
    expect(checked).toEqual(["TypeScript", "React.js", "Node.js"]);
  });

  it("leaves an already-checked matching option checked and doesn't double-count it", async () => {
    const container = document.querySelector<HTMLElement>('[data-field-path="techstack-demo"]')!;
    document.getElementById("tech-0")!.setAttribute("checked", "");
    (document.getElementById("tech-0") as HTMLInputElement).checked = true;

    const { picked } = decomposeContainer(container);
    const { filled } = await fillAnswersByLocator([{ locator: picked[0].locator, answer: "TypeScript | GraphQL" }]);
    expect(filled).toBe(1);

    const checked = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .filter((cb) => cb.checked)
      .map((cb) => cb.name);
    expect(checked.sort()).toEqual(["GraphQL", "TypeScript"]);
  });
});
