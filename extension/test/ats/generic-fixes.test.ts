import { describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { detectSemanticField } from "@/features/autofill/field-detector";
import { fillComboboxAnswer } from "@/features/autofill/combobox";
import { isRevealedPasswordField } from "@/features/autofill/password-fields";
import {
  datePatternOf,
  formatDatePattern,
  parseDateParts,
  pickBestOption,
  salutationCandidates,
} from "@/features/autofill/ats/shared";
import { testProfile } from "../fixtures";

/** Engine changes made for Workday/SuccessFactors whose cause is generic, checked on plain markup. */

describe("a question-shaped label is not a field name", () => {
  it("doesn't read '…für Deutschland?' as a country field", () => {
    document.body.innerHTML = `
      <form><label for="q">Benötigen Sie eine Arbeitserlaubnis für Deutschland?</label><input id="q" type="text">
      <label for="c">Land</label><input id="c" type="text">
      <label for="e">E-Mail?</label><input id="e" type="text"></form>`;
    expect(detectSemanticField(document.getElementById("q")!)).toBeNull();
    expect(detectSemanticField(document.getElementById("c")!)).toBe("country");
    expect(detectSemanticField(document.getElementById("e")!)).toBe("email");
  });
});

describe("a password box shown as text is still a password box", () => {
  it("is never filled with a profile value", async () => {
    document.body.innerHTML = `
      <form><label for="u">E-Mail-Adresse</label><input id="u" type="text">
      <label for="p">Kennwort</label><input id="p" type="text">
      <label for="w">Wohnort</label><input id="w" type="text">
      <input id="x" name="user_pwd" type="text"></form>`;
    await autofillDocument(testProfile());
    expect((document.getElementById("u") as HTMLInputElement).value).toBe("ada@example.com");
    expect((document.getElementById("p") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("x") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("w") as HTMLInputElement).value).toBe("Berlin");
    expect(isRevealedPasswordField(document.getElementById("w")!)).toBe(false);
  });
});

describe("a <button aria-haspopup=listbox> only takes a value by picking", () => {
  it("never gets the answer typed into it when no option matches", async () => {
    document.body.innerHTML = `<label for="b">Pick one</label><button id="b" type="button" aria-haspopup="listbox">Select One</button>`;
    const btn = document.getElementById("b")!;
    btn.addEventListener("click", () => {
      if (document.getElementById("lst")) return;
      const ul = document.createElement("ul");
      ul.id = "lst";
      ul.setAttribute("role", "listbox");
      ul.innerHTML = `<li role="option">Yes</li><li role="option">No</li>`;
      ul.querySelectorAll("li").forEach((li) => li.addEventListener("click", () => (btn.textContent = li.textContent)));
      document.body.append(ul);
      btn.setAttribute("aria-controls", "lst");
    });
    expect(await fillComboboxAnswer(btn, "Maybe")).toBe(false);
    expect(btn.textContent).toBe("Select One");
    expect(await fillComboboxAnswer(btn, "No")).toBe(true);
    expect(btn.textContent).toBe("No");
  });
});

describe("ATS option helpers", () => {
  it("matches options exactly first, then by prefix, never a 2-letter code by substring", () => {
    expect(pickBestOption(["Germany (+49)", "Ghana (+233)"], ["Germany"])).toBe("Germany (+49)");
    expect(pickBestOption(["Deutsche Bank Career Site", "Denmark"], ["DE"])).toBeNull();
    expect(pickBestOption(["Herr", "Frau"], salutationCandidates("Ms"))).toBe("Frau");
    expect(pickBestOption(["Mr.", "Ms.", "Mx."], salutationCandidates("Mr"))).toBe("Mr.");
    expect(pickBestOption(["Landline", "Mobile - BCM**", "Mobile"], ["Mobile"])).toBe("Mobile");
  });

  it("reads and writes dates in the shapes ATS fields use", () => {
    expect(parseDateParts("2021-04")).toEqual({ year: 2021, month: 4, day: null });
    expect(parseDateParts("04/2021")).toEqual({ year: 2021, month: 4, day: null });
    expect(parseDateParts("15.01.2027")).toEqual({ year: 2027, month: 1, day: 15 });
    expect(parseDateParts("soon")).toBeNull();
    const d = { year: 2027, month: 1, day: 5 };
    expect(formatDatePattern(d, "dd.MM.yyyy")).toBe("05.01.2027");
    expect(formatDatePattern(d, "MM/dd/yyyy")).toBe("01/05/2027");
    expect(formatDatePattern(d, "MMM d, y")).toBe("Jan 5, 2027");
    expect(datePatternOf("TT.MM.JJJJ")).toBe("dd.MM.yyyy");
    expect(datePatternOf("Search")).toBeNull();
  });
});

describe("CV history parsing", () => {
  it("keeps valid entries, normalizes dates, drops what a form can't use", async () => {
    const { parseCvHistory } = await import("@/features/openai/extract-cv-history");
    const history = parseCvHistory(
      JSON.stringify({
        work: [
          { title: "Engineer", company: "Babbage & Co", location: "", from: "2017-09", to: "", description: "" },
          { title: "", company: "Ghost", location: "", from: "2015", to: "2016", description: "" },
          { title: "Intern", company: "X", location: "", from: "summer", to: "", description: "" },
        ],
        education: [{ school: "Universität Göttingen", degree: "M.Sc.", fieldOfStudy: "", from: "2012", to: "2017", grade: "" }],
        websites: ["https://ada.dev", "https://linkedin.com/in/ada", "ada@example.com"],
      }),
    );
    expect(history.work).toEqual([{ title: "Engineer", company: "Babbage & Co", location: undefined, from: "2017-09", to: null, description: undefined }]);
    expect(history.education[0]).toMatchObject({ school: "Universität Göttingen", degree: "M.Sc.", from: "2012", to: "2017" });
    expect(history.websites).toEqual(["https://ada.dev"]);
  });
});
