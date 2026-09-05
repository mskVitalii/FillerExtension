import { beforeEach, describe, expect, it } from "vitest";
import { fillElement } from "@/features/autofill/native-setter";

/**
 * `<input type="number">` follows the HTML value-sanitization algorithm: a
 * non-numeric string assigned to `.value` is silently reset to `""` rather
 * than rejected with an error — so a free-text AI answer for a numeric
 * custom question (salary, years of experience, headcount…) must be coerced
 * before it's ever handed to the element, or the field ends up empty and
 * required-field validation blocks submission with no visible cause
 * (reported live on Stepstone: "Was ist Ihre jährliche Gehaltserwartung in
 * EUR?", `type="number"`, answered with prose).
 */
describe("fillElement on <input type=\"number\">", () => {
  let input: HTMLInputElement;

  beforeEach(() => {
    input = document.createElement("input");
    input.type = "number";
    document.body.appendChild(input);
  });

  it("passes a bare integer through unchanged", () => {
    expect(fillElement(input, "65000")).toBe(true);
    expect(input.value).toBe("65000");
  });

  it("passes a bare decimal through unchanged", () => {
    expect(fillElement(input, "3.5")).toBe(true);
    expect(input.value).toBe("3.5");
  });

  it("strips a currency symbol and German thousands-dot", () => {
    expect(fillElement(input, "€65.000")).toBe(true);
    expect(input.value).toBe("65000");
  });

  it("strips prose and a trailing unit", () => {
    expect(fillElement(input, "ca. 65.000 EUR")).toBe(true);
    expect(input.value).toBe("65000");
  });

  it("normalizes US thousands-comma + decimal-dot", () => {
    expect(fillElement(input, "65,000.50")).toBe(true);
    expect(input.value).toBe("65000.50");
  });

  it("normalizes a German decimal comma with no thousands grouping", () => {
    expect(fillElement(input, "ca. 3,5 Jahre")).toBe(true);
    expect(input.value).toBe("3.5");
  });

  it("picks a representative figure out of a range rather than concatenating it", () => {
    // The AI is instructed not to answer with a range at all (see
    // NUMERIC_RULE in answer-question.ts) — this only covers what happens
    // if one slips through anyway: the first number found, not garbage.
    expect(fillElement(input, "65000-75000")).toBe(true);
    expect(input.value).toBe("65000");
  });

  it("leaves the field untouched and reports failure when nothing number-shaped is found", () => {
    expect(fillElement(input, "keine Angabe")).toBe(false);
    expect(input.value).toBe("");
  });
});
