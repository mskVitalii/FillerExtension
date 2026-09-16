import { beforeEach, describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { loadFixture } from "./load-fixture";
import { testProfile } from "./fixtures";

/**
 * Runs the real `autofillDocument` engine against the actual manual test
 * page (`test-pages/autofill-test.html`) and asserts exact values per
 * section — a permanent regression guard for the label-detection /
 * phone-format / salary / country-select logic that has broken before.
 * Run with `npm test` (or `make test`); a red assertion here names exactly
 * which behavior regressed, no manual click-through needed.
 */
describe("autofillDocument against the manual test page", () => {
  beforeEach(() => {
    loadFixture();
  });

  it("fills plain name-attribute inputs and the country <select>", async () => {
    await autofillDocument(testProfile());
    expect(qs<HTMLInputElement>('input[name="first_name"]').value).toBe("Ada");
    expect(qs<HTMLInputElement>('input[name="last_name"]').value).toBe("Lovelace");
    expect(qs<HTMLInputElement>('input[name="email"]').value).toBe("ada@example.com");
    expect(qs<HTMLInputElement>('input[name="linkedin"]').value).toBe("https://linkedin.com/in/ada-lovelace");
    expect(qs<HTMLSelectElement>('select[name="country"]').value).toBe("DE");
    // Not a known profile field — the engine must leave it alone.
    expect(qs<HTMLTextAreaElement>('textarea[name="message"]').value).toBe("");
  });

  it("a lone phone field with no format hint gets the full E.164 number", async () => {
    await autofillDocument(testProfile());
    expect(qs<HTMLInputElement>('input[name="phone"]').value).toBe("+491745624691");
  });

  it("formats every salary field shape to the same rounded bare integer", async () => {
    await autofillDocument(testProfile());
    expect(qs<HTMLInputElement>('input[name="salary_num"]').value).toBe("65000");
    expect(qs<HTMLInputElement>('[aria-label="Salary expectation / Gehaltsvorstellung"]').value).toBe("65000");
    expect(qs<HTMLInputElement>('[aria-label="Desired salary"]').value).toBe("65000");
  });

  it("a single phone field with a '+'-shaped placeholder gets the grouped international form", async () => {
    await autofillDocument(testProfile());
    expect(qs<HTMLInputElement>('[aria-label="Phone number"]').value).toBe("+49 174 5624691");
  });

  it("a numeric-only phone field (no dial-code sibling) still carries the country code, digits only", async () => {
    await autofillDocument(testProfile());
    expect(qs<HTMLInputElement>('[aria-label="Phone"][inputmode="numeric"]').value).toBe("491745624691");
  });

  it("a phone field with a real sibling dial-code <select> gets only the national number, and the select gets the code", async () => {
    await autofillDocument(testProfile());
    const select = qs<HTMLSelectElement>('[aria-label="Country code"]');
    const input = select.closest("label")!.querySelector('input[aria-label="Phone"]') as HTMLInputElement;
    expect(select.value).toBe("+49");
    expect(input.value).toBe("1745624691");
  });

  it("matches a country <select> in the page's own language", async () => {
    await autofillDocument(testProfile());
    expect(qs<HTMLSelectElement>('select[name="land"]').value).toBe("DE");
  });

  /**
   * Regression test for a real greenhouse.io bug caught in review: its phone
   * section pairs a plain `<input>` with a react-select "Country" combobox
   * (not a native `<select>`) that picks the dial code — labelled literally
   * "Country", so without this fix it collided with the *address*-country
   * pattern and got the applicant's home-country name typed into a dial-code
   * picker. It must stay exactly as the page defaulted it ("+49"), and the
   * phone field should get the national-only number since the combobox
   * already shows this number's own calling code.
   */
  it("never types the applicant's address-country into a greenhouse.io-style phone dial-code combobox", async () => {
    await autofillDocument(testProfile());
    const combobox = qs<HTMLInputElement>("#gh-country");
    expect(combobox.value).toBe("");
    expect(document.querySelector(".select__single-value")!.textContent).toBe("+49");
    expect(qs<HTMLInputElement>("#gh-phone").value).toBe("1745624691");
  });

  it("fills aria-label/placeholder-only fields with no name or id", async () => {
    await autofillDocument(testProfile());
    expect(qs<HTMLInputElement>('[aria-label="Given name"]').value).toBe("Ada");
    expect(qs<HTMLInputElement>('[placeholder="Family name"]').value).toBe("Lovelace");
    expect(qs<HTMLInputElement>('[aria-label="E-mail address"]').value).toBe("ada@example.com");
  });

  it("fills fields matched purely by an autocomplete token", async () => {
    await autofillDocument(testProfile());
    expect(qs<HTMLInputElement>('input[autocomplete="given-name"]').value).toBe("Ada");
    expect(qs<HTMLInputElement>('input[autocomplete="family-name"]').value).toBe("Lovelace");
    expect(qs<HTMLInputElement>('input[autocomplete="email"]').value).toBe("ada@example.com");
    expect(qs<HTMLInputElement>('input[autocomplete="tel"]').value).toBe("+491745624691");
    expect(qs<HTMLInputElement>('input[autocomplete="postal-code"]').value).toBe("10115");
  });

  it("fills a contenteditable field via its aria-label", async () => {
    await autofillDocument(testProfile());
    expect(qs('[data-testid="fullname-editable"]').textContent).toBe("Ada Lovelace");
  });

  it("fills a custom role=combobox field", async () => {
    await autofillDocument(testProfile());
    expect(qs('[role="combobox"][aria-label="Country"]').textContent).toBe("Germany");
  });
});

function qs<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`fixture missing expected element: ${selector}`);
  return el;
}
