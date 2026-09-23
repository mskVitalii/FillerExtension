import { beforeEach, describe, expect, it } from "vitest";
import { detectCheckboxes, isNewsletterLike, setChecked } from "@/features/autofill/checkboxes";

/**
 * spec_8 item 5: a newsletter/marketing opt-in built as a toggle-switch
 * widget (`role="switch"`, `aria-checked`) rather than a native
 * `<input type="checkbox">` — common in component libraries (MUI/Ant/
 * Chakra) — must still be picked up by the automatic consent pass, and
 * `isNewsletterLike` (the fallback safety net in decide-checkboxes.ts) must
 * recognize it so it's never ticked even if the AI pass fails to return a
 * decision for it.
 */
describe("toggle-switch newsletter opt-in", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <form>
        <input type="text" name="email" />
        <button type="button" role="switch" aria-checked="false" name="newsletter">
          Subscribe to our newsletter
        </button>
      </form>
    `;
  });

  it("detects a role=switch element the same way as a checkbox", () => {
    const boxes = detectCheckboxes();
    expect(boxes).toHaveLength(1);
    expect(boxes[0].name).toBe("newsletter");
    expect(boxes[0].label).toContain("Subscribe to our newsletter");
    expect(boxes[0].checked).toBe(false);
  });

  it("toggles a role=switch element via aria-checked, not the .checked property", () => {
    const el = document.querySelector<HTMLElement>('[role="switch"]')!;
    expect(setChecked(el, true)).toBe(true);
    expect(el.getAttribute("aria-checked")).toBe("true");
  });
});

describe("isNewsletterLike", () => {
  it("recognizes newsletter/marketing/job-alert phrasing", () => {
    expect(isNewsletterLike("Subscribe to our newsletter")).toBe(true);
    expect(isNewsletterLike("Send me marketing emails")).toBe(true);
    expect(isNewsletterLike("Benachrichtigungen über neue Stellenausschreibungen erhalten")).toBe(true);
  });

  it("does not flag genuine consent/eligibility wording", () => {
    expect(isNewsletterLike("I agree to the privacy policy and terms of service")).toBe(false);
    expect(isNewsletterLike("I am at least 18 years old")).toBe(false);
  });
});
