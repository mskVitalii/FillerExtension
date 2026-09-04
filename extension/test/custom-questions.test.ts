import { beforeEach, describe, expect, it } from "vitest";
import { detectCustomQuestions, fillCustomQuestionAnswers, questionAnswerKey } from "@/features/autofill/custom-questions";
import { loadFixture } from "./load-fixture";

describe("automatic custom-question detection and fill (Application questions section)", () => {
  beforeEach(() => {
    loadFixture();
  });

  it("detects the 4 question-shaped fields and none of the plain profile fields", () => {
    const questions = detectCustomQuestions().map((q) => q.question);
    expect(questions).toEqual(
      expect.arrayContaining([
        "Waren Sie bereits bei der AVL Gruppe beschäftigt?",
        "Aktueller oder letzter Arbeitgeber",
        "Bei Mitarbeiterempfehlung bitte den/die Namen angeben",
        // Its own wrapping <label> text wins over its (German) aria-label —
        // same label-beats-aria-label priority as everywhere else in the
        // codebase (field-detector.ts, field-signal.ts).
        "Preferred entry date / period of notice",
      ]),
    );
    // A plain profile field (e.g. "First name") must never show up here —
    // that's Autofill's job, not the question-answer pipeline's.
    expect(questions.some((q) => /first name/i.test(q))).toBe(false);
  });

  it("writes each answer into its own field, matched by question text", () => {
    const answers: Record<string, string> = {
      "Waren Sie bereits bei der AVL Gruppe beschäftigt?": "Nein",
      "Aktueller oder letzter Arbeitgeber": "Acme GmbH",
    };
    const filled = fillCustomQuestionAnswers(answers);
    expect(filled).toBe(2);
    expect(qs<HTMLInputElement>('[aria-label="Waren Sie bereits bei der AVL Gruppe beschäftigt?"]').value).toBe("Nein");
    expect(qs<HTMLInputElement>('[aria-label="Aktueller oder letzter Arbeitgeber"]').value).toBe("Acme GmbH");
  });

  it("never overwrites a field the user (or a previous run) already filled in", () => {
    qs<HTMLInputElement>('[aria-label="Aktueller oder letzter Arbeitgeber"]').value = "Already typed";
    const filled = fillCustomQuestionAnswers({ "Aktueller oder letzter Arbeitgeber": "AI answer" });
    expect(filled).toBe(0);
    expect(qs<HTMLInputElement>('[aria-label="Aktueller oder letzter Arbeitgeber"]').value).toBe("Already typed");
  });

  it("also finds the real, distinct questions in the 'Custom question cards' section — no <label>, generic placeholder, real question in a sibling <p>", () => {
    const questions = detectCustomQuestions().map((q) => q.question);
    // Neither field collapses to the shared generic placeholder text, and
    // each gets its own distinct real question rather than colliding.
    expect(questions.some((q) => q === "Type your answer here...")).toBe(false);
    expect(questions.some((q) => q.includes("work from the Munich office"))).toBe(true);
    expect(questions.some((q) => q.includes("production system"))).toBe(true);
  });
});

/**
 * Regression test for: two picker-added fields sharing an identical
 * detected `question` text (very plausible — e.g. two textareas with the
 * same generic "Type your answer here…" placeholder, as in the "Custom
 * question cards" section) must not collapse into the same answer slot.
 * `answerAndFillQuestions` (Side Panel) keys its answers map with this
 * function specifically to avoid that collision — this locks the contract
 * it depends on.
 */
describe("questionAnswerKey", () => {
  it("keys locator-carrying (picker-added) questions by their locator, not by text", () => {
    const a = { question: "Type your answer here...", locator: { tag: "f1", selector: "", textHint: "" } };
    const b = { question: "Type your answer here...", locator: { tag: "f2", selector: "", textHint: "" } };
    expect(questionAnswerKey(a)).not.toBe(questionAnswerKey(b));
  });

  it("keys auto-detected (no locator) questions by their text, so a re-scan still matches", () => {
    const a = { question: "Why do you want to work here?" };
    const b = { question: "Why do you want to work here?" };
    expect(questionAnswerKey(a)).toBe(questionAnswerKey(b));
    expect(questionAnswerKey(a)).toBe("Why do you want to work here?");
  });
});

function qs<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`fixture missing expected element: ${selector}`);
  return el;
}
