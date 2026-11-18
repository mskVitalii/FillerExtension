import { describe, expect, it } from "vitest";
import { detectSemanticField } from "@/features/autofill/field-detector";
import { detectCustomQuestions } from "@/features/autofill/custom-questions";
import { pickLocationOption } from "@/features/autofill/location";
import { injectFileIntoPage } from "@/features/file-upload/inject-file";
import { activeAtsAdapter } from "@/features/autofill/ats";
import { pdf } from "./harness";

/** Small, synthetic regressions for the generic fixes the ATS fixtures surfaced. */

function field(html: string): HTMLElement {
  document.body.innerHTML = `<form>${html}</form>`;
  return document.querySelector<HTMLElement>("[data-t]")!;
}

describe("label patterns", () => {
  it("a yes/no question ending in 'Deutschland' is not the country field", () => {
    const el = field('<label for="q">Hast du eine gültige Arbeitserlaubnis für Deutschland?</label><input id="q" data-t>');
    expect(detectSemanticField(el)).toBeNull();
  });

  it("still knows 'Land' and 'Wohnsitzland' as country", () => {
    expect(detectSemanticField(field('<label for="q">Land*</label><input id="q" data-t>'))).toBe("country");
    expect(detectSemanticField(field('<label for="q">Wohnsitzland</label><input id="q" data-t>'))).toBe("country");
  });

  it("'First and last name' / 'Vor- und Nachname' ask for the full name", () => {
    expect(detectSemanticField(field('<label for="q">First and last name</label><input id="q" data-t>'))).toBe("fullName");
    expect(detectSemanticField(field('<label for="q">Vor- und Nachname</label><input id="q" data-t>'))).toBe("fullName");
    expect(detectSemanticField(field('<label for="q">Last name</label><input id="q" data-t>'))).toBe("lastName");
  });

  it("an unlabelled-for-phone type=tel input is the phone", () => {
    expect(detectSemanticField(field('<label for="q">Number</label><input id="q" type="tel" data-t>'))).toBe("phone");
  });

  it("'target annual salary (gross)' and 'expected yearly salary' are the salary", () => {
    expect(detectSemanticField(field('<label for="q">What is your target annual salary (*gross*)?</label><input id="q" data-t>'))).toBe(
      "expectedSalary",
    );
    expect(detectSemanticField(field('<label for="q">What is your expected yearly salary?</label><input id="q" data-t>'))).toBe("expectedSalary");
  });

  it("a bare 'Location' field is the city, a question about a preferred location is not", () => {
    expect(detectSemanticField(field('<label for="q">Current location ✱</label><input id="q" data-t>'))).toBe("city");
    expect(detectSemanticField(field('<label for="q">What is your preferred work location?</label><input id="q" data-t>'))).toBeNull();
  });
});

describe("pickLocationOption", () => {
  it("chooses the applicant's city in the applicant's country, whatever the geocoder's format", () => {
    expect(pickLocationOption(["Berlin, New Hampshire, United States", "Berlin, Berlin, Germany"], "Berlin", "Germany")).toBe(
      "Berlin, Berlin, Germany",
    );
    expect(pickLocationOption(["Berlin, CT, USA", "Berlin, DEU"], "Berlin", "Germany")).toBe("Berlin, DEU");
    expect(pickLocationOption(["München, Bayern, Deutschland"], "München", "Germany")).toBe("München, Bayern, Deutschland");
  });

  it("refuses a same-named town abroad rather than guessing", () => {
    expect(pickLocationOption(["Berlin, CT, USA", "Berlin, Maryland, United States"], "Berlin", "Germany")).toBeNull();
  });
});

describe("custom questions", () => {
  it("a required field with a short label is a question", async () => {
    document.body.innerHTML =
      '<form><label for="a">Notice Period*</label><input id="a" aria-required="true"><label for="b">Nickname</label><input id="b"></form>';
    const questions = (await detectCustomQuestions()).map((q) => q.question);
    expect(questions).toEqual(["Notice Period"]);
  });

  it("skips react-select's hidden required mirror input", async () => {
    document.body.innerHTML =
      '<form><label for="a">Why do you want this job?</label><input id="a"><input required tabindex="-1" aria-hidden="true" value=""></form>';
    expect(await detectCustomQuestions()).toHaveLength(1);
  });
});

describe("Lever 'Additional information'", () => {
  it("is offered as a question, with Lever's own cover-letter hint", async () => {
    document.body.innerHTML = `
      <form id="application-form"><button data-qa="btn-submit" type="button">Submit application</button>
        <ul><li class="application-question"><label><div class="application-label">Full name<span class="required">✱</span></div>
          <div class="application-field"><input type="text" name="name"></div></label></li></ul>
        <ul><li class="application-question"><label><div class="application-label">Additional information</div>
          <div class="application-field"><textarea name="comments" placeholder="Add a cover letter or anything else you want to share."></textarea></div></label></li></ul>
      </form>`;
    expect(activeAtsAdapter()?.id).toBe("lever");
    const questions = await detectCustomQuestions();
    expect(questions).toHaveLength(1);
    expect(questions[0].question).toMatch(/Additional information/);
    expect(questions[0].question).toMatch(/cover letter/);
  });
});

describe("file upload", () => {
  it("never hands the cover letter to the form's only (CV) upload", () => {
    document.body.innerHTML = '<form><label for="cv">Resume/CV</label><input type="file" id="cv"></form>';
    const cv = document.getElementById("cv") as HTMLInputElement;
    injectFileIntoPage(pdf("cv.pdf"), null, "cv");
    injectFileIntoPage(pdf("letter.pdf"), null, "coverLetter");
    expect(cv.files?.[0]?.name).toBe("cv.pdf");
  });

  it("still uses a lone unlabelled upload for either kind", () => {
    document.body.innerHTML = '<form><input type="file" id="f"></form>';
    injectFileIntoPage(pdf("letter.pdf"), null, "coverLetter");
    expect((document.getElementById("f") as HTMLInputElement).files?.[0]?.name).toBe("letter.pdf");
  });
});

describe("consent vs. choice checkboxes", () => {
  it("two consent sentences sharing a name stay consent checkboxes; short shared-name options don't", async () => {
    const { detectCheckboxes } = await import("@/features/autofill/checkboxes");
    document.body.innerHTML = `<form><input type="text" name="email">
      <label><input type="checkbox" name="consents[]" value="a"> I agree to the processing of my personal data for this application</label>
      <label><input type="checkbox" name="consents[]" value="b"> Keep me in the talent pool and send me future job opportunities</label>
      <label><input type="checkbox" name="where[]" value="de" required> Within Germany</label>
      <label><input type="checkbox" name="where[]" value="eu" required> Within the EU</label></form>`;
    const labels = detectCheckboxes().map((c) => c.label);
    expect(labels).toHaveLength(2);
    expect(labels.every((l) => /agree|talent pool/.test(l))).toBe(true);
  });
});
