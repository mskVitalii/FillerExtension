import { describe, expect, it } from "vitest";
import { matchSalaryBracket } from "@/lib/salary";
import { autofillDocument } from "@/features/autofill/engine";
import { testProfile } from "./fixtures";

describe("matchSalaryBracket", () => {
  const brackets = [
    "25.000€ - 35.000€",
    "35.000€ - 45.000€",
    "45.000€ - 55.000€",
    "55.000€ - 65.000€",
    "65.000€ - 75.000€",
    "75.000€ - 85.000€",
    "85.000€ - 95.000€",
    "95.000€ - 105.000€",
    "105.000€ - 115.000€",
    "115.000€ +",
  ];

  it("picks the bracket containing the parsed salary's midpoint", () => {
    expect(matchSalaryBracket(brackets, "68000")).toBe("65.000€ - 75.000€");
    expect(matchSalaryBracket(brackets, "40k")).toBe("35.000€ - 45.000€");
  });

  it("treats a trailing '+' bracket as open-ended", () => {
    expect(matchSalaryBracket(brackets, "150000")).toBe("115.000€ +");
    expect(matchSalaryBracket(brackets, "120000")).toBe("115.000€ +");
  });

  it("falls back to the numerically closest bracket when none actually contains the value", () => {
    const withGap = ["25.000€ - 35.000€", "80.000€ - 90.000€"];
    // 50000 is nearer 35000's midpoint (30000) than 80000-90000's (85000)? No —
    // distance to 30000 is 20000, distance to 85000 is 35000, so the lower one wins.
    expect(matchSalaryBracket(withGap, "50000")).toBe("25.000€ - 35.000€");
  });

  it("returns null when the profile value doesn't parse as a salary at all", () => {
    expect(matchSalaryBracket(brackets, "not a number")).toBeNull();
  });

  it("returns null when none of the options parse as a salary bracket", () => {
    expect(matchSalaryBracket(["Yes", "No"], "65000")).toBeNull();
  });
});

/**
 * Regression coverage for a real bug reported live on greenhouse.io: its
 * salary-range question is a react-select-style widget with no typeable
 * input at all — a `<select>` there (some ATSes render it as a plain native
 * dropdown instead) or a flyout combobox, both offering only discrete
 * bracket choices like "55.000€ - 65.000€". The old bulk-autofill code path
 * (`engine.ts`) just typed a bare rounded number into whatever the field
 * was, which silently does nothing on either shape. `autofillDocument` must
 * now pick the bracket containing the profile's expected salary instead.
 */
describe("autofillDocument fills a discrete salary-bracket field (spec_5-adjacent, greenhouse.io)", () => {
  it("selects the matching option on a native <select> of salary brackets", async () => {
    document.body.innerHTML = `
      <label for="salary-select">Expected salary
        <select id="salary-select" aria-label="Expected salary">
          <option value="">Please select</option>
          <option>25.000€ - 35.000€</option>
          <option>35.000€ - 45.000€</option>
          <option>45.000€ - 55.000€</option>
          <option>55.000€ - 65.000€</option>
          <option>65.000€ - 75.000€</option>
        </select>
      </label>
    `;
    await autofillDocument({ ...testProfile(), expectedSalary: "68000" });
    expect((document.getElementById("salary-select") as HTMLSelectElement).value).toBe("65.000€ - 75.000€");
  });

  /**
   * Mirrors the exact DOM shape reported live: a react-select-style
   * multi-select flyout (`aria-multiselectable="true"`, stays open after a
   * click) that only opens via its own `<button aria-label="Toggle flyout">`
   * — clicking or typing into the input itself does nothing.
   */
  it("opens the flyout and clicks the matching bracket option on a toggle-driven react-select combobox", async () => {
    document.body.innerHTML = `
      <label for="salary-combo">Expected salary
        <div>
          <input id="salary-combo" role="combobox" aria-label="Expected salary" aria-haspopup="listbox" aria-controls="salary-combo-listbox" />
          <button type="button" aria-label="Toggle flyout"></button>
        </div>
      </label>
      <div id="salary-combo-listbox" role="listbox" aria-multiselectable="true"></div>
    `;
    const toggle = document.querySelector('button[aria-label="Toggle flyout"]')!;
    const listbox = document.getElementById("salary-combo-listbox")!;
    const brackets = [
      "25.000€ - 35.000€",
      "35.000€ - 45.000€",
      "45.000€ - 55.000€",
      "55.000€ - 65.000€",
      "65.000€ - 75.000€",
      "75.000€ - 85.000€",
      "115.000€ +",
    ];
    let mousedownSelected = "";
    let comboClicked = false;
    document.getElementById("salary-combo")!.addEventListener("mousedown", () => {
      comboClicked = true;
    });
    toggle.addEventListener("mousedown", () => {
      listbox.innerHTML = brackets.map((text) => `<div role="option">${text}</div>`).join("");
    });
    listbox.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if (target.getAttribute("role") === "option") mousedownSelected = target.textContent ?? "";
    });

    const result = await autofillDocument({ ...testProfile(), expectedSalary: "68000" });
    expect(result.filled).toBe(1);
    expect(mousedownSelected).toBe("65.000€ - 75.000€");
    // Only the toggle button opens the menu on this widget — the input
    // itself must never also receive a competing open/close toggle.
    expect(comboClicked).toBe(false);
    // The trigger itself is never typed into for this widget shape.
    expect((document.getElementById("salary-combo") as HTMLInputElement).value).toBe("");
  });
});
