import { describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { detectSemanticField } from "@/features/autofill/field-detector";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";
import { detectCheckboxes } from "@/features/autofill/checkboxes";
import { injectFileIntoPage } from "@/features/file-upload/inject-file";
import { salutationCandidates } from "@/features/autofill/salutation";
import { testProfile } from "../fixtures";
import { pdf } from "./harness";

/**
 * The generic rules the real ATS forms needed, on minimal synthetic markup — so a custom company
 * portal with the same pattern gets the same fill, whatever its ATS.
 */
function form(html: string): void {
  document.body.innerHTML = `<form>${html}</form>`;
}
const el = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

describe("field detection", () => {
  it.each([
    ['<label for="t">Titel:</label><input id="t" name="title">', null],
    ['<label for="t">Title</label><select id="t" name="title"><option>Mr</option><option>Ms</option></select>', "salutation"],
    ['<label for="t">Anredetitel</label><select id="t"><option>Dr.</option></select>', null],
    ['<label for="g">Geschlecht</label><select id="g"><option>Weiblich</option></select>', "salutation"],
    ['<label for="a">Adresszusatz:</label><input id="a" name="address1">', null],
    ['<label for="a">Straße:</label><input id="a" name="address2">', "address"],
    ['<label for="p">Telefon alternativ:</label><input id="p" name="alternativeTelephone">', null],
    ['<label for="n">Vor- und Nachname des Mitarbeiters (m/w/d):</label><input id="n">', null],
    ['<label for="s">Gehaltswunsch Bruttojahresgehalt (nur Zahl)</label><input id="s">', "expectedSalary"],
    ['<label for="s">Desired annual salary</label><input id="s">', "expectedSalary"],
    ['<label for="o">PLZ, Ort</label><input id="o" name="ort">', "city"],
    ['<label><input type="radio" name="start" id="r"> Ab sofort</label>', null],
    ['<label for="x">Auslandserfahrung</label><select id="x" name="f[erfahrung_ausland]"><option>0-2</option></select>', null],
    ['<label for="x">Staatsangehörigkeit / Nationality</label><input id="x">', null],
  ])("%s → %s", (html, field) => {
    form(html);
    expect(detectSemanticField(el("input, select"))).toBe(field);
  });

  it("a hidden select's options are not the label of the widget after it", () => {
    form(
      '<label for="src-button">Wie haben Sie uns gefunden?</label><select id="src" style="display:none"><option>LinkedIn</option></select><span id="src-button" role="combobox"></span>',
    );
    expect(detectSemanticField(el("#src-button"))).toBeNull();
  });
});

describe("autofill", () => {
  it("never fills an aria-hidden honeypot", async () => {
    form('<label for="w1">Website</label><input id="w1" name="homepage"><div aria-hidden="true"><label for="w2">Website</label><input id="w2" name="website" tabindex="-1"></div>');
    await autofillDocument(testProfile());
    expect(el<HTMLInputElement>("#w1").value).toBe("https://ada.dev");
    expect(el<HTMLInputElement>("#w2").value).toBe("");
  });

  it("never fills a honeypot that says so in its label or is Workday's beecatcher", async () => {
    // Workday's create-account page: a visible "website" box whose label tells humans to leave it alone.
    form(
      '<label for="w1">Website</label><input id="w1" name="homepage">' +
        '<label for="hp">Enter website. This input is for robots only, do not enter if you\'re human.</label><input data-automation-id="beecatcher" id="hp" name="website" type="text">' +
        '<label for="hp2">Website</label><input data-automation-id="beecatcher" id="hp2" name="url" type="text">',
    );
    await autofillDocument(testProfile());
    expect(el<HTMLInputElement>("#w1").value).toBe("https://ada.dev");
    expect(el<HTMLInputElement>("#hp").value).toBe("");
    expect(el<HTMLInputElement>("#hp2").value).toBe("");
  });

  it("maps the salutation onto the form's own words, in a select and as radios", async () => {
    form(`
      <label for="a">Anrede</label><select id="a"><option value="">--</option><option value="m">Herr</option><option value="f">Frau</option></select>
      <fieldset><legend>Persönliche Daten</legend>
        <label><input type="radio" name="sal" value="1"> Herr</label>
        <label><input type="radio" name="sal" value="2"> Frau</label>
        <label><input type="radio" name="sal" value="3"> Divers</label>
      </fieldset>`);
    await autofillDocument(testProfile());
    expect(el<HTMLSelectElement>("#a").value).toBe("f");
    expect(el<HTMLInputElement>('input[value="2"]').checked).toBe(true);
    expect(salutationCandidates("Herr")).toContain("male");
  });

  it("fills a jQuery UI selectmenu through its hidden select and repaints it", async () => {
    form(`
      <label for="country-button">Land</label>
      <select id="country" name="f[country]" style="display:none"><option value="">---</option><option value="X1">Deutschland</option></select>
      <span id="country-button" role="combobox" class="ui-selectmenu-button"><span class="ui-selectmenu-text">---</span></span>`);
    // jsdom: the inline display:none doesn't empty offsetParent (see test/setup.ts).
    el("#country").setAttribute("data-fx-hidden", "");
    await autofillDocument(testProfile());
    expect(el<HTMLSelectElement>("#country").value).toBe("X1");
    expect(el("#country-button .ui-selectmenu-text").textContent).toBe("Deutschland");
  });

  it("leaves a salary's currency and period selects alone", async () => {
    form(`<label for="s">Gehaltsvorstellung (brutto)</label><input id="s" type="number">
      <select id="c" name="currency_salary"><option value="EUR" selected>EUR</option><option value="USD">USD</option></select>
      <select id="p" name="salary_period"><option value="j" selected>pro Jahr</option><option value="m">pro Monat</option></select>`);
    el("#c").setAttribute("aria-label", "Gehaltsvorstellung Währung");
    await autofillDocument(testProfile());
    expect(el<HTMLInputElement>("#s").value).toBe("65000");
    expect(el<HTMLSelectElement>("#c").value).toBe("EUR");
    expect(el<HTMLSelectElement>("#p").value).toBe("j");
  });
});

describe("questions and checkboxes", () => {
  it("asks one-word choice fields and required fields, and radio groups with their locator", async () => {
    form(`
      <label for="e">Schulabschluss</label><select id="e"><option>---</option><option>Abitur</option></select>
      <label for="n">Staatsangehörigkeit:<span class="required-mark">*</span></label><input id="n">
      <label for="k">Kommentar:</label><textarea id="k"></textarea>
      <div class="field"><h3>Verfügbarkeit</h3><div>
        <label><input type="radio" name="start" value="0"> Ab sofort</label>
        <label><input type="radio" name="start" value="1"> Kündigungsfrist</label></div></div>`);
    const questions = await detectCustomQuestions();
    expect(questions.map((q) => q.question)).toEqual(["Schulabschluss", "Staatsangehörigkeit:", "Verfügbarkeit"]);
    expect(questions[2].locator).toBeDefined();
    expect(questions[2].options).toEqual(["Ab sofort", "Kündigungsfrist"]);
  });

  it("offers a consent checkbox hidden behind its styled label", () => {
    form('<input name="n"><input type="checkbox" id="agb" name="agbs" style="display:none"><label for="agb">Ich akzeptiere die Datenschutzrichtlinien.</label>');
    el("#agb").setAttribute("data-fx-hidden", "");
    expect(detectCheckboxes().map((c) => c.name)).toEqual(["agbs"]);
  });
});

describe("document slots", () => {
  function uploads(html: string): void {
    form(html);
    injectFileIntoPage(pdf("cv.pdf"), null, "cv");
    injectFileIntoPage(pdf("cover-letter.pdf"), null, "coverLetter");
  }
  const files = (name: string) => Array.from(el<HTMLInputElement>(`[name="${name}"]`).files ?? []).map((f) => f.name);

  it("CV → Lebenslauf, cover letter → Anschreiben; never a parser, photo or Zeugnisse slot", () => {
    uploads(`
      <div id="cvparser"><input type="file" name="cv_upload"><a>Lebenslauf hochladen</a></div>
      <label for="f">Foto</label><input type="file" id="f" name="foto">
      <label for="a">Anschreiben</label><input type="file" id="a" name="anschreiben">
      <label for="l">Lebenslauf</label><input type="file" id="l" name="lebenslauf">
      <label for="z">Arbeitszeugnisse</label><input type="file" id="z" name="zeugnisse">`);
    expect(files("lebenslauf")).toEqual(["cv.pdf"]);
    expect(files("anschreiben")).toEqual(["cover-letter.pdf"]);
    expect([...files("cv_upload"), ...files("foto"), ...files("zeugnisse")]).toEqual([]);
  });

  it("with no CV slot the CV goes into the complete-documents slot, not into 'Weitere Dokumente (Zeugnisse)'", () => {
    uploads(`
      <label for="u">Vollständige Bewerbungsunterlagen</label><input type="file" id="u" name="docs">
      <label for="w">Weitere Dokumente (Arbeitszeugnisse, Zertifikate)</label><input type="file" id="w" name="more">`);
    expect(files("docs")).toEqual(["cv.pdf"]);
    expect(files("more")).toEqual([]);
  });

  it("a cover letter doesn't replace the CV in a shared 'Anschreiben / Komplette Unterlagen' slot", () => {
    uploads('<label for="a">Anschreiben / Komplette Unterlagen</label><input type="file" id="a" name="all"><label for="f">Foto</label><input type="file" id="f" name="foto">');
    expect(files("all")).toEqual(["cv.pdf"]);
  });
});
