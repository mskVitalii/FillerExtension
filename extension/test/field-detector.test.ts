import { describe, expect, it } from "vitest";
import { detectSemanticField } from "@/features/autofill/field-detector";

/**
 * Reported live: a `name="cxsrec__e_mail_address__c"` text input labelled
 * "E-Mail Adresse" was detected as `address` and filled with the profile's
 * street address instead of the email — the `address`/`adresse` patterns'
 * email-guard was a forward-only `(?!.*email)` lookahead, which only
 * excludes "email" appearing *after* "address" in the same string. Both the
 * German label ("E-Mail Adresse") and the compound `name` attribute have
 * "email" immediately *before* "address", which a lookahead never sees —
 * and since `name` is the first signal `detectSemanticField` checks
 * (ahead of the label), the field never even reached the label that would
 * have matched `email` correctly.
 */
describe("detectSemanticField — email vs. address", () => {
  function input(attrs: Record<string, string>, label?: string): HTMLInputElement {
    const el = document.createElement("input");
    el.type = "text";
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (label) {
      const labelEl = document.createElement("label");
      labelEl.setAttribute("for", attrs.id);
      labelEl.textContent = label;
      document.body.appendChild(labelEl);
    }
    document.body.appendChild(el);
    return el;
  }

  it("detects email, not address, from a compound name attribute (the reported case)", () => {
    const el = input(
      { id: "cxsField_3", name: "cxsrec__e_mail_address__c" },
      "E-Mail Adresse",
    );
    expect(detectSemanticField(el)).toBe("email");
  });

  it("detects email, not address, from the German label alone (no informative name attribute)", () => {
    const el = input({ id: "f1", name: "field_1" }, "E-Mail Adresse");
    expect(detectSemanticField(el)).toBe("email");
  });

  it("detects email, not address, from an English compound label", () => {
    const el = input({ id: "f2", name: "field_2" }, "Email Address");
    expect(detectSemanticField(el)).toBe("email");
  });

  it("still detects a genuine address field (no over-correction)", () => {
    const el = input({ id: "f3", name: "street_address" }, "Street Address");
    expect(detectSemanticField(el)).toBe("address");
  });

  it("still detects a genuine German address field (no over-correction)", () => {
    const el = input({ id: "f4", name: "adresse" }, "Adresse");
    expect(detectSemanticField(el)).toBe("address");
  });

  it("still detects a genuine plain email field", () => {
    const el = input({ id: "f5", name: "email" }, "E-Mail");
    expect(detectSemanticField(el)).toBe("email");
  });
});

/**
 * Reported live: a free-text application question whose `<label>` is a whole
 * paragraph got a profile value stuffed into it because a short keyword
 * pattern matched a word buried in the prose — "…specializing in *mobile*
 * interfaces" matched `phone`, "…a team eff*ort*…" matched `city` (`ort\b`).
 * A free-text signal (label / placeholder / nearby text) that reads as a
 * question prompt rather than a field label is no longer pattern-matched.
 */
describe("detectSemanticField — prose labels are not field types", () => {
  function fieldWithLabel(name: string, tag: "input" | "textarea", label: string): HTMLElement {
    const el = document.createElement(tag);
    el.setAttribute("name", name);
    el.setAttribute("id", name);
    const labelEl = document.createElement("label");
    labelEl.setAttribute("for", name);
    labelEl.textContent = label;
    document.body.append(labelEl, el);
    return el;
  }

  it("does not treat 'mobile' inside a long question prompt as a phone field", () => {
    const el = fieldWithLabel(
      "short_phrase",
      "input",
      'Describe yourself in a short phrase. e.g. "Machine learning engineer from Twitter", ' +
        '"DevOps engineer who scaled a site to 10M+ users", "Frontend developer specializing in mobile interfaces"',
    );
    expect(detectSemanticField(el)).toBeNull();
  });

  it("does not treat 'effort' (⊃ 'ort') inside a long question prompt as a city field", () => {
    const el = fieldWithLabel(
      "proud_project",
      "textarea",
      "Optionally, describe a project that you worked on that you are proud of. If you are describing " +
        "a team effort, please be specific about your personal contribution.",
    );
    expect(detectSemanticField(el)).toBeNull();
  });

  it("still matches a short, real label", () => {
    expect(detectSemanticField(fieldWithLabel("f_a", "input", "Mobile number"))).toBe("phone");
    expect(detectSemanticField(fieldWithLabel("f_b", "input", "City"))).toBe("city");
  });
});
