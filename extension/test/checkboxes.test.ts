import { beforeEach, describe, expect, it } from "vitest";
import { applyCheckboxDecisions, detectCheckboxes } from "@/features/autofill/checkboxes";
import { loadFixture } from "./load-fixture";

describe("checkbox detection and decision application", () => {
  beforeEach(() => {
    loadFixture();
  });

  it("detects all 5 consent/marketing checkboxes with their current state", () => {
    const boxes = detectCheckboxes();
    const byName = Object.fromEntries(boxes.map((b) => [b.name, b]));
    expect(Object.keys(byName).sort()).toEqual(["job_alerts", "marketing", "privacy", "talent_pool", "terms"]);
    expect(byName.privacy.required).toBe(true);
    expect(byName.terms.required).toBe(true);
    expect(byName.job_alerts.required).toBe(false);
    // The fixture ships this one pre-checked — a real "marketing opt-in
    // already on by default" pattern the AI pass must actively turn off.
    expect(byName.marketing.checked).toBe(true);
  });

  it("ticks the required consents, leaves marketing off, and reports how many actually changed", () => {
    const changed = applyCheckboxDecisions([
      { name: "privacy", label: "", check: true },
      { name: "terms", label: "", check: true },
      { name: "job_alerts", label: "", check: false },
      { name: "marketing", label: "", check: false },
      { name: "talent_pool", label: "", check: false },
    ]);
    // privacy, terms and marketing actually flip state; job_alerts and
    // talent_pool were already off, so those two are no-ops.
    expect(changed).toBe(3);

    expect(cb("privacy").checked).toBe(true);
    expect(cb("terms").checked).toBe(true);
    expect(cb("job_alerts").checked).toBe(false);
    expect(cb("marketing").checked).toBe(false);
    expect(cb("talent_pool").checked).toBe(false);
  });
});

function cb(name: string): HTMLInputElement {
  return document.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
}
