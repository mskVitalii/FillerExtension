import { describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { detectCustomQuestions, fillCustomQuestionAnswers } from "@/features/autofill/custom-questions";
import { applyCheckboxDecisions, detectCheckboxes, isNewsletterLike } from "@/features/autofill/checkboxes";
import { injectFileIntoPage } from "@/features/file-upload/inject-file";
import { atsStep, detectAts } from "@/features/autofill/ats";
import { testProfile } from "../fixtures";
import { loadAtsFixture } from "./widgets";

const byId = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;

function file(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

/** Every profile value, so a test can say "none of these leaked into that field". */
const PROFILE_VALUES = Object.values(testProfile()).filter(Boolean);

describe("SuccessFactors: detection", () => {
  it("recognizes SF hosts and SF pages on any host", () => {
    const empty = document.implementation.createHTMLDocument("x");
    expect(detectAts("https://career5.successfactors.eu/career?company=ACME&career_ns=job_listing", empty)?.id).toBe("successfactors");
    expect(detectAts("https://career2.sapsf.eu/career?company=ACME", empty)?.id).toBe("successfactors");
    expect(detectAts("https://jobs.example.de/", empty)).toBeNull();
    loadAtsFixture("successfactors/create-account.html");
    expect(detectAts("https://jobs.example.de/career", document)?.id).toBe("successfactors");
  });
});

describe("SuccessFactors: Create an Account (captured live)", () => {
  it("fills email twice, names and country; both password boxes get one generated password", async () => {
    loadAtsFixture("successfactors/create-account.html");
    const result = await autofillDocument(testProfile());

    expect(byId("fbclc_userName").value).toBe("ada@example.com");
    expect(byId("fbclc_emailConf").value).toBe("ada@example.com");
    expect(byId("fbclc_fName").value).toBe("Ada");
    expect(byId("fbclc_lName").value).toBe("Lovelace");
    expect(byId<HTMLSelectElement>("fbclc_country").value).toBe("DE");

    const password = byId("fbclc_pwd").value;
    expect(result.generatedPassword).toBe(password);
    expect(password).not.toBe("");
    expect(byId("fbclc_pwdConf").value).toBe(password);
    expect(PROFILE_VALUES).not.toContain(password);
  });

  it("never puts a profile value into a password box revealed by its Show button", async () => {
    loadAtsFixture("successfactors/create-account.html");
    // togglePassword('fbclc_pwd', …) → type=text; the German UI labels it "Kennwort".
    for (const id of ["fbclc_pwd", "fbclc_pwdConf"]) byId(id).type = "text";
    document.querySelector("label[for='fbclc_pwd']")!.textContent = "Kennwort wählen:";
    document.querySelector("label[for='fbclc_pwdConf']")!.textContent = "Kennwort wiederholen:";
    await autofillDocument(testProfile());
    expect(byId("fbclc_pwd").value).toBe("");
    expect(byId("fbclc_pwdConf").value).toBe("");

    const questions = await detectCustomQuestions();
    expect(questions.map((q) => q.question).join(" ")).not.toMatch(/kennwort|password/i);
  });

  it("offers the marketing opt-in to the consent pass and treats it as a newsletter", () => {
    loadAtsFixture("successfactors/create-account.html");
    const labels = detectCheckboxes().map((c) => c.label);
    expect(labels).toContain("Hear more about career opportunities");
    expect(isNewsletterLike("Hear more about career opportunities")).toBe(true);
    expect(isNewsletterLike("Receive new job posting notifications")).toBe(true);
  });

  it("is the register step; account creation is the user's call", () => {
    loadAtsFixture("successfactors/create-account.html");
    const step = atsStep(document)!;
    expect(step).toMatchObject({ ats: "successfactors", kind: "register", nextIsSubmit: false });
    expect(step.next?.id).toBe("fbclc_createAccountButton");
  });
});

describe("SuccessFactors: Sign In (captured live)", () => {
  it("fills the email and leaves the password alone", async () => {
    loadAtsFixture("successfactors/sign-in.html");
    const result = await autofillDocument(testProfile());
    expect(byId("username").value).toBe("ada@example.com");
    expect(byId("password").value).toBe("");
    expect(result.generatedPassword).toBeNull();
    expect(atsStep(document)).toMatchObject({ kind: "login" });
  });
});

describe("SuccessFactors: classic application page (synthetic)", () => {
  it("fills the profile, salutation and country by their option texts", async () => {
    loadAtsFixture("successfactors/apply-classic.html");
    await autofillDocument(testProfile());

    expect(byId<HTMLSelectElement>("31:").selectedOptions[0].textContent).toBe("Ms.");
    expect(byId("32:").value).toBe("Ada");
    expect(byId("33:").value).toBe("Lovelace");
    expect(byId("34:").value).toBe("ada@example.com");
    expect(byId("35:").value).toBe("+491745624691");
    expect(byId("36:").value).toBe("12 Analytical Engine Ave");
    expect(byId("37:").value).toBe("Berlin");
    expect(byId("38:").value).toBe("10115");
    expect(byId<HTMLSelectElement>("39:").selectedOptions[0].textContent).toBe("Germany");
    expect(byId("53:").value).toBe("65000");
    // Questions are the AI's, not the profile's.
    expect(byId<HTMLSelectElement>("52:").value).toBe("");
    expect(byId("51:").value).toBe("");
    expect(byId("54:").value).toBe("");
  });

  it("asks the questions with their shapes and writes dates in the field's pattern", async () => {
    loadAtsFixture("successfactors/apply-classic.html");
    await autofillDocument(testProfile());
    const questions = await detectCustomQuestions();
    const q = (re: RegExp) => questions.find((x) => re.test(x.question));

    expect(q(/start date/)?.dateKind).toBe("date");
    expect(q(/relocate/)?.options).toEqual(["No Selection", "Yes", "No"]);
    expect(q(/notice period/)).toBeDefined();
    expect(q(/interested/)).toBeDefined();
    expect(q(/Salary/)).toBeUndefined();

    const { filled, unfilled } = await fillCustomQuestionAnswers({
      [q(/start date/)!.question]: "2027-01-15",
      [q(/relocate/)!.question]: "Yes",
      [q(/notice period/)!.question]: "3 months",
    });
    expect(unfilled).toEqual([]);
    expect(filled).toBe(3);
    expect(byId("51:").value).toBe("15.01.2027");
    expect(byId<HTMLSelectElement>("52:").value).toBe("y");
  });

  it("puts each document into its own row", () => {
    loadAtsFixture("successfactors/apply-classic.html");
    expect(injectFileIntoPage(file("cv.pdf"), null, "cv").nativeInputs).toBe(1);
    expect(injectFileIntoPage(file("letter.pdf"), null, "coverLetter").nativeInputs).toBe(1);
    expect(byId("61:_file").files?.[0]?.name).toBe("cv.pdf");
    expect(byId("62:_file").files?.[0]?.name).toBe("letter.pdf");
    expect(byId("63:_file").files).toHaveLength(0);
  });

  it("finds the privacy consent and the job-alert opt-in", () => {
    loadAtsFixture("successfactors/apply-classic.html");
    const boxes = detectCheckboxes();
    expect(boxes.map((b) => b.required)).toEqual([true, false]);
    expect(isNewsletterLike(boxes[1].label)).toBe(true);
  });

  it("is a one-page form whose Apply button submits", () => {
    loadAtsFixture("successfactors/apply-classic.html");
    const step = atsStep(document)!;
    expect(step).toMatchObject({ kind: "review", nextIsSubmit: true });
    expect(step.next?.id).toBe("applyBtn");
  });
});

describe("SuccessFactors: SAPUI5 apply wizard (synthetic, German)", () => {
  it("fills inputs, picks the UI5 Select and ComboBox options, and skips the revealed password", async () => {
    loadAtsFixture("successfactors/apply-ui5.html");
    await autofillDocument(testProfile());

    expect(byId("__select0").querySelector(".sapMSltLabel")?.textContent).toBe("Frau");
    expect(byId("__input1-inner").value).toBe("Ada");
    expect(byId("__input2-inner").value).toBe("Lovelace");
    expect(byId("__input3-inner").value).toBe("ada@example.com");
    expect(byId("__input4-inner").value).toBe("+491745624691");
    expect(byId("__input5-inner").value).toBe("12 Analytical Engine Ave");
    expect(byId("__input6-inner").value).toBe("10115");
    expect(byId("__input7-inner").value).toBe("Berlin");
    expect(byId("__box0-inner").value).toBe("Deutschland");

    expect(byId("__input9-inner").value).toBe(""); // "Kennwort"
    expect(byId("__uploader0-fu_input-inner").value).toBe("");
    expect(byId("__select1").querySelector(".sapMSltLabel")?.textContent).toBe("");
  });

  it("asks the questions with UI5 options and date shape, and writes the answers", async () => {
    loadAtsFixture("successfactors/apply-ui5.html");
    await autofillDocument(testProfile());
    const questions = await detectCustomQuestions();
    const q = (re: RegExp) => questions.find((x) => re.test(x.question));

    expect(q(/umzuziehen/)?.options).toEqual(["Ja", "Nein"]);
    expect(q(/frühestens/)?.dateKind).toBe("date");
    expect(q(/reizt/)).toBeDefined();
    expect(questions.map((x) => x.question).join(" ")).not.toMatch(/Kennwort|Lebenslauf|Anschreiben/);

    const { filled } = await fillCustomQuestionAnswers({
      [q(/umzuziehen/)!.question]: "Ja",
      [q(/frühestens/)!.question]: "15.01.2027",
      [q(/reizt/)!.question]: "Die Aufgaben.",
    });
    expect(filled).toBe(3);
    expect(byId("__select1").querySelector(".sapMSltLabel")?.textContent).toBe("Ja");
    expect(byId("__picker0-inner").value).toBe("15.01.2027");
    expect(byId<HTMLTextAreaElement>("__area0-inner").value).toBe("Die Aufgaben.");
  });

  it("sees UI5 checkboxes (not their hidden mirrors) without a <form>, and ticks one", () => {
    loadAtsFixture("successfactors/apply-ui5.html");
    const boxes = detectCheckboxes();
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toMatchObject({ required: true, checked: false });
    expect(isNewsletterLike(boxes[1].label)).toBe(true);
    expect(applyCheckboxDecisions([{ name: "", label: boxes[0].label, check: true }])).toBe(1);
    expect(byId("__box1").getAttribute("aria-checked")).toBe("true");
    expect(byId("__box2").getAttribute("aria-checked")).toBe("false");
  });

  it("routes Lebenslauf and Anschreiben to their uploaders", () => {
    loadAtsFixture("successfactors/apply-ui5.html");
    injectFileIntoPage(file("lebenslauf.pdf"), null, "cv");
    injectFileIntoPage(file("anschreiben.pdf"), null, "coverLetter");
    expect(byId("__uploader0-fu").files?.[0]?.name).toBe("lebenslauf.pdf");
    expect(byId("__uploader1-fu").files?.[0]?.name).toBe("anschreiben.pdf");
  });

  it("reports wizard step 2 of 3 with Weiter as next", () => {
    loadAtsFixture("successfactors/apply-ui5.html");
    const step = atsStep(document)!;
    expect(step).toMatchObject({ kind: "form", name: "Persönliche Daten", index: 2, total: 3, nextIsSubmit: false });
    expect(step.next?.textContent).toBe("Weiter");
    expect(step.back?.textContent).toBe("Zurück");
  });
});
