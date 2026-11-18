import { beforeEach, describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";
import { detectCheckboxes } from "@/features/autofill/checkboxes";
import { injectFileIntoPage } from "@/features/file-upload/inject-file";
import { isQuestionShaped } from "@/features/autofill/field-signal";
import { salutationCandidates } from "@/lib/salutation";
import { EMPTY_PROFILE } from "@/types/profile";

/**
 * Generic engine rules found on the German SMB ATS (softgarden, Personio, Recruitee, join.com),
 * pinned on minimal markup so they hold beyond those fixtures (`test/ats/`).
 */

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("salutation in the form's own language", () => {
  it("knows the spellings of each salutation, the profile's own first", () => {
    expect(salutationCandidates("Ms").slice(0, 2)).toEqual(["Ms", "Frau"]);
    expect(salutationCandidates("Herr")).toContain("Mr");
    expect(salutationCandidates("Mx")).toContain("Divers");
    expect(salutationCandidates("Dr.")).toEqual(["Dr."]);
  });

  it("picks Frau for Ms in an Anrede select, and never Herr", async () => {
    document.body.innerHTML = `<form><label for="a">Anrede</label>
      <select id="a" name="anrede"><option value="">Bitte wählen</option><option value="1">Herr</option><option value="2">Frau</option><option value="3">Divers</option></select></form>`;
    await autofillDocument({ ...EMPTY_PROFILE, salutation: "Ms" });
    expect(document.querySelector<HTMLSelectElement>("#a")!.value).toBe("2");
  });
});

describe("Postleitzahl", () => {
  it("is the postal code", async () => {
    document.body.innerHTML = `<form><label for="p">Postleitzahl</label><input id="p" name="custom_attribute_1"></form>`;
    await autofillDocument({ ...EMPTY_PROFILE, postalCode: "10115" });
    expect(document.querySelector<HTMLInputElement>("#p")!.value).toBe("10115");
  });
});

describe("fields nobody can type into", () => {
  it("are neither filled nor asked about", async () => {
    document.body.innerHTML = `<form>
      <p>Bitte eine Option wählen und Lebenslauf hochladen</p>
      <input aria-hidden="true" tabindex="-1" name="resumeUploaded">
      <label for="e">E-Mail</label><input id="e" name="email" readonly>
      <p>Wie lange ist deine Erfahrung im Vertrieb?</p>
      <input readonly tabindex="-1" name="answer">
    </form>`;
    await autofillDocument({ ...EMPTY_PROFILE, email: "ada@example.com" });
    expect(document.querySelector<HTMLInputElement>("#e")!.value).toBe("");
    expect(await detectCustomQuestions()).toEqual([]);
  });
});

describe("one- and two-word application questions", () => {
  it("reads start date and notice period labels as questions", () => {
    for (const label of ["Verfügbar ab", "Available from", "Eintrittstermin", "Kündigungsfrist", "Notice period", "Earliest start date"]) {
      expect(isQuestionShaped(label), label).toBe(true);
    }
    expect(isQuestionShaped("Vorname")).toBe(false);
  });
});

describe("upload slots", () => {
  const file = (name: string) => new File(["%PDF"], name, { type: "application/pdf" });

  it("never puts the cover letter into the page's only slot when that slot is the CV's", () => {
    document.body.innerHTML = `<form><label for="cv">CV</label><input type="file" id="cv" name="cv"></form>`;
    injectFileIntoPage(file("letter.pdf"), null, "coverLetter");
    expect(document.querySelector<HTMLInputElement>("#cv")!.files).toHaveLength(0);
  });

  it("prefers the slot named for the document over a question that mentions it", () => {
    document.body.innerHTML = `<form>
      <input type="file" name="candidate.coverLetterFile" id="slot">
      <label for="q">Hier können Sie ein Anschreiben hochladen</label><input type="file" id="q" name="candidate.openQuestionAnswers.1.file">
    </form>`;
    injectFileIntoPage(file("letter.pdf"), null, "coverLetter");
    expect(document.querySelector<HTMLInputElement>("#slot")!.files).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>("#q")!.files).toHaveLength(0);
  });

  it("does not also drop the file on a dropzone that wraps its own file input", () => {
    document.body.innerHTML = `<form><div class="dropzone" id="z"><input type="file" name="cv"> Lebenslauf</div></form>`;
    const drops: string[] = [];
    document.querySelector("#z")!.addEventListener("drop", () => drops.push("drop"));
    const result = injectFileIntoPage(file("cv.pdf"), null, "cv");
    expect(result).toEqual({ nativeInputs: 1, dropZones: 0 });
    expect(drops).toEqual([]);
  });
});

describe("select-all-that-apply options", () => {
  it("are not consent checkboxes; a lone consent in the same fieldset still is", () => {
    document.body.innerHTML = `<form><input name="email"><fieldset><legend>Which do you use? Select all that apply.</legend>
      <label><input type="checkbox" name="q.multi" value="a" required> Unity</label>
      <label><input type="checkbox" name="q.multi" value="b" required> Unreal</label>
      <label><input type="checkbox" name="privacy" required> Ich akzeptiere die Datenschutzerklärung</label>
    </fieldset></form>`;
    expect(detectCheckboxes().map((c) => c.name)).toEqual(["privacy"]);
  });
});

describe("the page's own header", () => {
  it("is not an application question (Personio's language switcher)", async () => {
    document.body.innerHTML = `<header role="banner"><button type="button" role="combobox" aria-label="Select language, current: English">English</button></header>
      <form><label for="q">Why do you want to join us?</label><textarea id="q"></textarea></form>`;
    expect((await detectCustomQuestions()).map((q) => q.question)).toEqual(["Why do you want to join us?"]);
  });
});

describe("a dial-code button combobox", () => {
  it("is never typed into, and the field that has focus is left alone", async () => {
    document.body.innerHTML = `<form><label for="e">E-Mail</label><input id="e" name="email">
      <button type="button" role="combobox" aria-label="Ländervorwahl auswählen: Deutschland">+49</button></form>`;
    document.querySelector<HTMLInputElement>("#e")!.focus();
    await autofillDocument({ ...EMPTY_PROFILE, email: "ada@example.com", country: "Germany", phone: "+49 174 5624691" });
    expect(document.querySelector<HTMLInputElement>("#e")!.value).toBe("ada@example.com");
    expect(document.querySelector("button")!.textContent).toBe("+49");
  });
});
