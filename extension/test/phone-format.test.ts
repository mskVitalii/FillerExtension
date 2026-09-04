import { describe, expect, it } from "vitest";
import { resolvePhoneFill } from "@/features/autofill/field-format";

/**
 * Direct regression test for the "1745624691 typed raw into every phone
 * field" bug: `findDialCodeField` used to climb 4 fixed ancestor levels and
 * take the *first* dial-code-shaped field anywhere in that (often huge)
 * container, so two unrelated phone inputs sharing a `fieldset` with the
 * *one real* dial-code select both wrongly paired with it and got the bare
 * national-significant number — which happened to equal the raw, unparsed
 * profile value for this exact number, hiding the bug as "nothing got
 * formatted at all".
 */
function el(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.firstElementChild as HTMLElement;
}

const RAW_PHONE = "1745624691";
const COUNTRY = "Germany";

describe("resolvePhoneFill", () => {
  it("a lone field (no sibling dial-code field) gets the full number with its country code", () => {
    const input = el(`<input aria-label="Phone number" placeholder="+49 170 1234567" />`);
    document.body.append(input);
    const fill = resolvePhoneFill(input, RAW_PHONE, COUNTRY);
    expect(fill).not.toBeNull();
    expect(fill!.dialCodeField).toBeNull();
    expect(fill!.value).toBe("+49 174 5624691");
  });

  it("a lone field never falls back to the bare leading-0 national form", () => {
    const input = el(`<input aria-label="Telefon" placeholder="0170 1234567" />`);
    document.body.append(input);
    const fill = resolvePhoneFill(input, RAW_PHONE, COUNTRY);
    expect(fill!.value).not.toBe("01745624691");
    expect(fill!.value.replace(/\s/g, "")).toMatch(/^\+49/);
  });

  it("a numeric-only field (can't type '+') still carries the country code, digits only", () => {
    const input = el(`<input aria-label="Phone" inputmode="numeric" pattern="[0-9]+" />`);
    document.body.append(input);
    const fill = resolvePhoneFill(input, RAW_PHONE, COUNTRY);
    expect(fill!.dialCodeField).toBeNull();
    expect(fill!.value).toBe("491745624691");
  });

  it("pairs with a genuinely adjacent dial-code select, taking only the national number", () => {
    const label = el(`
      <label>
        <select aria-label="Country code">
          <option value="">--</option>
          <option value="+49">Germany (+49)</option>
        </select>
        <input aria-label="Phone" placeholder="170 1234567" />
      </label>
    `);
    document.body.append(label);
    const input = label.querySelector("input")!;
    const select = label.querySelector("select")!;

    const fill = resolvePhoneFill(input, RAW_PHONE, COUNTRY);
    expect(fill!.dialCodeField).toBe(select);
    expect(fill!.value).toBe("1745624691");
  });

  it("does NOT pair with a dial-code select that only shares a wide, unrelated container", () => {
    // Several standalone fields plus the one real dial-code pair, all
    // inside one shared fieldset — exactly the shape that broke before
    // (mirrors `test-pages/autofill-test.html`'s "Format-specific phone /
    // salary / country" fieldset, which has 7+ fields sharing a container
    // with the one real dial-code select).
    const fieldset = el(`
      <fieldset>
        <label>Salary <input id="salary" aria-label="Desired salary" /></label>
        <label>Phone A <input id="phoneA" aria-label="Phone number" placeholder="+49 170 1234567" /></label>
        <label>Phone B <input id="phoneB" aria-label="Telefon" placeholder="0170 1234567" /></label>
        <label>Country <select id="country"><option value="DE">Germany</option></select></label>
        <label>
          <select aria-label="Country code">
            <option value="">--</option>
            <option value="+49">Germany (+49)</option>
          </select>
          <input id="phoneC" aria-label="Phone" placeholder="170 1234567" />
        </label>
      </fieldset>
    `);
    document.body.append(fieldset);

    const phoneA = fieldset.querySelector("#phoneA") as HTMLElement;
    const phoneB = fieldset.querySelector("#phoneB") as HTMLElement;
    const phoneC = fieldset.querySelector("#phoneC") as HTMLElement;

    expect(resolvePhoneFill(phoneA, RAW_PHONE, COUNTRY)!.dialCodeField).toBeNull();
    expect(resolvePhoneFill(phoneB, RAW_PHONE, COUNTRY)!.dialCodeField).toBeNull();
    // The real pair still works from inside the same fieldset.
    expect(resolvePhoneFill(phoneC, RAW_PHONE, COUNTRY)!.dialCodeField).not.toBeNull();
  });
});
