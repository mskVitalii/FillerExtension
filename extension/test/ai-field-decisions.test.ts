import { beforeEach, describe, expect, it, vi } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { clearAiDecisionCache, type FieldDecider, type FieldDecisionRequest } from "@/features/autofill/ai-assist";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";
import { DECISION_THRESHOLDS, type DecisionAnswers } from "@/features/openai/decisions";
import { NO_OPTION, NOT_PROFILE, fieldDecisionQuestions, readFieldDecisions } from "@/features/openai/decide-fields";
import type { ProfileFieldKey } from "@/types/profile";
import { testProfile } from "./fixtures";

/**
 * The Autofill's AI pass (`ai-assist.ts`), driven by a stubbed decider: no network, no key.
 * The stub answers by label — the way the Decisions API would for these fields.
 */

const profile = { ...testProfile(), city: "Munich", country: "Germany", expectedSalary: "65 000 €" };

function stubDecider(answers: { options?: Record<string, string>; fields?: Record<string, ProfileFieldKey> }) {
  const requests: FieldDecisionRequest[] = [];
  const decide: FieldDecider = vi.fn(async (request: FieldDecisionRequest) => {
    requests.push(request);
    return {
      optionPicks: request.optionPicks.map((q) => ({ id: q.id, choice: answers.options?.[q.label] ?? null })),
      fieldKinds: request.fieldKinds.map((q) => ({ id: q.id, field: answers.fields?.[q.signals.label] ?? null })),
    };
  });
  return { decide, requests };
}

const value = (id: string) => (document.getElementById(id) as HTMLSelectElement | HTMLInputElement).value;

const DROPDOWNS = `
  <form>
    <label for="country">Country</label>
    <select id="country"><option value="">Bitte wählen</option><option value="1">Republik Österreich</option><option value="2">Bundesrepublik Deutschland</option></select>
    <label for="city">City</label>
    <select id="city"><option value="">Bitte wählen</option><option value="1">Berlin / Berlin</option><option value="2">München / Bayern</option></select>
    <label for="salary">Expected salary</label>
    <select id="salary"><option value="">Bitte wählen</option><option value="1">unter 60 TEUR</option><option value="2">60 bis 70 TEUR</option><option value="3">über 70 TEUR</option></select>
  </form>`;

const PICKS = {
  Country: "Bundesrepublik Deutschland",
  City: "München / Bayern",
  "Expected salary": "60 bis 70 TEUR",
};

beforeEach(() => {
  clearAiDecisionCache();
  document.body.innerHTML = "";
});

describe("AI fallback for dropdown options no offline matcher found", () => {
  it("leaves them unfilled without a decider, exactly as before", async () => {
    document.body.innerHTML = DROPDOWNS;
    const result = await autofillDocument(profile);
    expect([value("country"), value("city"), value("salary")]).toEqual(["", "", ""]);
    expect(result.filled).toBe(0);
  });

  it("asks once for every miss of the pass and picks the chosen options (Germany → Deutschland, a salary bracket, Munich → München)", async () => {
    document.body.innerHTML = DROPDOWNS;
    const { decide, requests } = stubDecider({ options: PICKS });
    const result = await autofillDocument(profile, { decideFields: decide });

    expect(decide).toHaveBeenCalledTimes(1);
    const picks = requests[0].optionPicks;
    expect(picks.map((p) => [p.label, p.field, p.value])).toEqual([
      ["Country", "country", "Germany"],
      ["City", "city", "Munich, Germany"],
      ["Expected salary", "expectedSalary", "65 000 €"],
    ]);
    expect(picks[0].options).toContain("Bundesrepublik Deutschland");
    expect([value("country"), value("city"), value("salary")]).toEqual(["2", "2", "2"]);
    expect(result.filled).toBe(3);
  });

  it("caches answers per (label, value, options): a second Autofill doesn't ask again", async () => {
    document.body.innerHTML = DROPDOWNS;
    const { decide } = stubDecider({ options: PICKS });
    await autofillDocument(profile, { decideFields: decide });
    document.body.innerHTML = DROPDOWNS; // the form re-rendered from scratch
    await autofillDocument(profile, { decideFields: decide });
    expect(decide).toHaveBeenCalledTimes(1);
    expect([value("country"), value("city"), value("salary")]).toEqual(["2", "2", "2"]);
  });

  it("keeps the offline result when the decider fails (no key) or declines", async () => {
    document.body.innerHTML = DROPDOWNS;
    const failing: FieldDecider = vi.fn(async () => {
      throw new Error("No OpenAI API key");
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await autofillDocument(profile, { decideFields: failing });
    expect([value("country"), value("city"), value("salary")]).toEqual(["", "", ""]);

    const { decide } = stubDecider({});
    await autofillDocument(profile, { decideFields: decide });
    expect([value("country"), value("city"), value("salary")]).toEqual(["", "", ""]);
  });

  it("picks the chosen row of a react-select flyout, by the texts it showed when the offline pick failed", async () => {
    document.body.innerHTML = `
      <label for="country-rs">Country</label>
      <div class="select__control">
        <input id="country-rs" role="combobox" aria-controls="country-list" />
        <button type="button" aria-label="Toggle flyout"></button>
      </div>
      <div id="country-list" role="listbox"></div>`;
    const input = document.getElementById("country-rs") as HTMLInputElement;
    const list = document.getElementById("country-list")!;
    document.querySelector("button")!.addEventListener("mousedown", () => {
      list.innerHTML = ["Republik Österreich", "BRD (Bundesrepublik)"].map((t) => `<div role="option">${t}</div>`).join("");
    });
    list.addEventListener("click", (e) => {
      input.value = (e.target as HTMLElement).textContent ?? "";
      list.innerHTML = "";
    });

    const { decide, requests } = stubDecider({ options: { Country: "BRD (Bundesrepublik)" } });
    await autofillDocument(profile, { decideFields: decide });
    expect(requests[0].optionPicks[0].options).toEqual(["Republik Österreich", "BRD (Bundesrepublik)"]);
    expect(input.value).toBe("BRD (Bundesrepublik)");
  });

  it("doesn't ask when the offline matcher already found the option", async () => {
    document.body.innerHTML = `<label for="c">Country</label><select id="c"><option value="">-</option><option value="de">Deutschland</option></select>`;
    const { decide } = stubDecider({});
    await autofillDocument(profile, { decideFields: decide });
    expect(value("c")).toBe("de");
    expect(decide).not.toHaveBeenCalled();
  });
});

describe("AI profile key for fields the detector couldn't classify", () => {
  const FORM = `
    <form>
      <label for="rn">Rufnummer</label><input id="rn" required>
      <label for="kd">Kundennummer</label><input id="kd">
      <label for="ref">E-Mail des Empfehlungsgebers</label><input id="ref">
      <label for="why">Why do you want to work with us?</label><textarea id="why"></textarea>
      <label for="res">Wohnsitz</label>
      <select id="res"><option value="">-</option><option value="1">Republik Österreich</option><option value="2">Bundesrepublik Deutschland</option></select>
    </form>`;

  it("asks only about short unclassified fields, fills the classified ones from the profile, then picks their options", async () => {
    document.body.innerHTML = FORM;
    const { decide, requests } = stubDecider({
      fields: { Rufnummer: "phone", Wohnsitz: "country" },
      options: { Wohnsitz: "Bundesrepublik Deutschland" },
    });
    await autofillDocument(profile, { decideFields: decide });

    expect(requests[0].fieldKinds.map((q) => q.signals.label)).toEqual(["Rufnummer", "Kundennummer", "Wohnsitz"]);
    expect(value("rn")).toContain("1745624691");
    expect(value("kd")).toBe("");
    expect(value("ref")).toBe("");
    // The country select's options didn't match "Germany" offline: one follow-up request.
    expect(decide).toHaveBeenCalledTimes(2);
    expect(requests[1].optionPicks.map((q) => q.label)).toEqual(["Wohnsitz"]);
    expect(value("res")).toBe("2");
  });

  it("treats a classified field as the profile's in later passes, not as a custom question", async () => {
    document.body.innerHTML = FORM;
    const before = (await detectCustomQuestions()).map((q) => q.question);
    expect(before).toContain("Rufnummer");

    const { decide } = stubDecider({ fields: { Rufnummer: "phone" } });
    await autofillDocument({ ...profile, phone: "" }, { decideFields: decide });
    const after = (await detectCustomQuestions()).map((q) => q.question);
    expect(after).not.toContain("Rufnummer");
  });
});

describe("decide-fields question building and thresholds", () => {
  const request: FieldDecisionRequest = {
    optionPicks: [{ id: "o0", field: "country", label: "Land", value: "Germany", options: ["Österreich", "Deutschland"] }],
    fieldKinds: [{ id: "f0", signals: { label: "Rufnummer", kind: "input:text" } }],
  };

  it("offers the page's options plus 'none', and the profile keys plus 'not a profile field'", () => {
    const [option, field] = fieldDecisionQuestions(request);
    expect(option.type === "choice" && option.choices.map((c) => c.value)).toEqual(["Österreich", "Deutschland", NO_OPTION]);
    expect(field.type === "choice" && field.choices.map((c) => c.value)).toContain(NOT_PROFILE);
    expect(field.type === "choice" && field.choices.map((c) => c.value)).toContain("phone");
  });

  it("returns null below the threshold and for 'none of these'", () => {
    const answers = (option: string, optionConfidence: number, field: string, fieldConfidence: number): DecisionAnswers =>
      new Map([
        ["o0", { type: "choice", name: "o0", choice: option, confidence: optionConfidence, probabilities: [] }],
        ["f0", { type: "choice", name: "f0", choice: field, confidence: fieldConfidence, probabilities: [] }],
      ]);
    const sure = readFieldDecisions(request, answers("Deutschland", 0.9, "phone", 0.9));
    expect(sure).toEqual({ optionPicks: [{ id: "o0", choice: "Deutschland" }], fieldKinds: [{ id: "f0", field: "phone" }] });

    const unsure = readFieldDecisions(
      request,
      answers("Deutschland", DECISION_THRESHOLDS.optionMatch - 0.01, "phone", DECISION_THRESHOLDS.profileField - 0.01),
    );
    expect(unsure).toEqual({ optionPicks: [{ id: "o0", choice: null }], fieldKinds: [{ id: "f0", field: null }] });

    const declined = readFieldDecisions(request, answers(NO_OPTION, 0.99, NOT_PROFILE, 0.99));
    expect(declined).toEqual({ optionPicks: [{ id: "o0", choice: null }], fieldKinds: [{ id: "f0", field: null }] });
  });
});
