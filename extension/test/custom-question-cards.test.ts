import { beforeEach, describe, expect, it } from "vitest";
import { decomposeContainer } from "@/features/autofill/pick-questions";
import { loadFixture } from "./load-fixture";

/**
 * Regression test for: picking a "Custom question cards" field (no
 * <label>, the real question sits in a sibling <p> one row up, the
 * textarea's own placeholder is the generic "Type your answer here...")
 * produced no usable question when the pick landed exactly on the textarea
 * itself or its immediate wrapper — both very ordinary outcomes of hovering
 * the visual picker without pressing "↑" to widen first. `fromPrecedingText`
 * (field-signal.ts) stopped its climb *before* ever checking the picked
 * container's own preceding sibling, so the real `<p>` above it was never
 * found; the field fell back to the placeholder text, which read as
 * "question-shaped" (4 words) but isn't a real question — the AI then had
 * nothing to answer and returned a "please provide the question" non-answer,
 * which still got written into the field (masking the real bug as "the
 * insert doesn't work").
 */
describe("picking a 'Custom question cards' field (no <label>, question in a sibling <p>)", () => {
  beforeEach(() => {
    loadFixture();
  });

  it("recovers the real question when the pick lands exactly on the textarea itself", () => {
    const textarea = document.getElementById("question-field-1596056")!;
    const { picked } = decomposeContainer(textarea);
    expect(picked).toHaveLength(1);
    expect(picked[0].question).toContain("work from the Munich office");
    expect(picked[0].question).not.toBe("Type your answer here...");
    expect(picked[0].confident).toBe(true);
  });

  it("recovers the real question when the pick lands on the textarea's immediate wrapper div", () => {
    const wrapper = document.getElementById("question-field-1596057")!.parentElement!;
    const { picked } = decomposeContainer(wrapper);
    expect(picked).toHaveLength(1);
    expect(picked[0].question).toContain("production system");
    expect(picked[0].confident).toBe(true);
  });

  it("still finds both questions when the whole section is picked in one go", () => {
    const wrapper = document.getElementById("question-field-1596056")!.parentElement!;
    const card = wrapper.parentElement!; // the bordered card div
    const section = card.parentElement!; // holds both cards
    const { picked } = decomposeContainer(section);
    expect(picked.map((p) => p.question)).toEqual([
      expect.stringContaining("work from the Munich office"),
      expect.stringContaining("production system"),
    ]);
  });
});
