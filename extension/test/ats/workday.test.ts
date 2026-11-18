import { describe, expect, it } from "vitest";
import { autofillDocument } from "@/features/autofill/engine";
import { detectCustomQuestions, fillCustomQuestionAnswers } from "@/features/autofill/custom-questions";
import { applyCheckboxDecisions, detectCheckboxes } from "@/features/autofill/checkboxes";
import { injectFileIntoPage } from "@/features/file-upload/inject-file";
import { atsStep, detectAts, fillWorkdayExperience } from "@/features/autofill/ats";
import type { CvHistory } from "@/features/autofill/ats";
import { testProfile } from "../fixtures";
import { loadAtsFixture, showOnly } from "./widgets";

const byId = <T extends HTMLElement = HTMLInputElement>(id: string) => document.getElementById(id) as T;
const aid = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-automation-id="${id}"]`)!;

function file(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

describe("Workday: detection", () => {
  it("recognizes myworkdayjobs.com hosts and the apply flow on a custom domain", () => {
    const empty = document.implementation.createHTMLDocument("x");
    expect(detectAts("https://acme.wd3.myworkdayjobs.com/en-US/Careers/job/Berlin/Dev_R1/apply", empty)?.id).toBe("workday");
    expect(detectAts("https://jobs.example.com/", empty)).toBeNull();
    loadAtsFixture("workday/my-information.html");
    expect(detectAts("https://careers.example.com/apply", document)?.id).toBe("workday");
  });
});

describe("Workday: My Information (captured live)", () => {
  it("fills the profile into the right fields, dropdowns by picking", async () => {
    loadAtsFixture("workday/my-information.html");
    const result = await autofillDocument(testProfile());

    expect(byId<HTMLButtonElement>("name--legalName--salutation").textContent).toBe("Frau"); // profile "Ms"
    expect(byId("name--legalName--firstName").value).toBe("Ada");
    expect(byId("name--legalName--lastName").value).toBe("Lovelace");
    expect(byId("address--addressLine1").value).toBe("12 Analytical Engine Ave");
    expect(byId("address--postalCode").value).toBe("10115");
    expect(byId("address--city").value).toBe("Berlin");
    expect(byId("emailAddress--emailAddress").value).toBe("ada@example.com");
    // The calling code has its own prompt (already Germany (+49)): the number is national.
    expect(byId("phoneNumber--phoneNumber").value).toBe("1745624691");
    expect(byId<HTMLButtonElement>("phoneNumber--phoneType").textContent).toBe("Mobile");
    expect(byId<HTMLButtonElement>("country--country").textContent).toBe("Germany");
    expect(result.filled).toBeGreaterThanOrEqual(9);
  });

  it("leaves everything that isn't the applicant's to say alone", async () => {
    loadAtsFixture("workday/my-information.html");
    await autofillDocument(testProfile());

    expect(byId<HTMLButtonElement>("source--source").textContent).toBe("Select One");
    expect(byId<HTMLButtonElement>("name--legalName--hereditary").textContent).toBe("Select One");
    expect(byId("phoneNumber--extension").value).toBe("");
    expect(byId("phoneNumber--countryPhoneCode").value).toBe(""); // a search box, never typed into
    expect(byId("d6b73").checked || byId("d6b74").checked).toBe(false);
    expect(byId("name--preferredCheck").checked).toBe(false);
    expect(aid<HTMLInputElement>("phone-sms-opt-in").checked).toBe(false);
    // The hidden value carriers beside each dropdown only change through a real pick.
    const carriers = Array.from(document.querySelectorAll<HTMLInputElement>("button[aria-haspopup='listbox'] + input"));
    expect(carriers.map((c) => c.value)).not.toContain("Ada");
    expect(carriers.map((c) => c.value)).not.toContain("Germany");
  });

  it("selects the country phone code when the prompt is empty", async () => {
    loadAtsFixture("workday/my-information.html");
    document.querySelector("[data-automation-id='selectedItemList']")!.innerHTML = "";
    await autofillDocument({ ...testProfile(), phone: "+43 660 1234567", country: "Austria" });
    const pill = document.querySelector("[data-automation-id='selectedItem']");
    expect(pill?.textContent).toBe("Austria (+43)");
    expect(byId("phoneNumber--phoneNumber").value).toBe("6601234567");
  });

  it("asks only the real questions, with the dropdown's own options, and picks the answer", async () => {
    loadAtsFixture("workday/my-information.html");
    await autofillDocument(testProfile());
    const questions = await detectCustomQuestions();
    const texts = questions.map((q) => q.question);

    expect(texts).toHaveLength(1);
    expect(texts[0]).toMatch(/^How Did You Hear About Us\?/);
    const source = questions.find((q) => /How Did You Hear/.test(q.question));
    expect(source?.options).toContain("LinkedIn");
    expect(source?.options).not.toContain("Select One");
    for (const t of texts) expect(t).not.toMatch(/Phone|Prefix|Extension|Given|Family|Email|Street|City|Postal/);

    const { filled } = await fillCustomQuestionAnswers({ [source!.question]: "Job Board" });
    expect(filled).toBe(1);
    expect(byId<HTMLButtonElement>("source--source").textContent).toBe("Job Board");
  });

  it("offers no checkbox to the consent pass (preferred name and SMS opt-in are not consents)", () => {
    loadAtsFixture("workday/my-information.html");
    expect(detectCheckboxes()).toEqual([]);
  });

  it("reports the step for the agent", () => {
    loadAtsFixture("workday/my-information.html");
    const step = atsStep(document)!;
    expect(step).toMatchObject({ ats: "workday", kind: "form", name: "My Information", index: 1, total: 5, nextIsSubmit: false });
    expect(step.next?.textContent).toBe("Next");
  });
});

describe("Workday: My Experience (synthetic)", () => {
  const history: CvHistory = {
    work: [
      { title: "Senior Engineer", company: "Analytical Engines GmbH", location: "Berlin", from: "2021-04", to: null, description: "Built the difference engine." },
      { title: "Engineer", company: "Babbage & Co", location: "London", from: "2017-09", to: "2021-03" },
    ],
    education: [{ school: "Universität Göttingen", degree: "M.Sc.", fieldOfStudy: "Mathematics", from: "2012", to: "2017", grade: "1.3" }],
    websites: ["https://ada.dev"],
  };

  it("fills one entry per job and degree, adding entries as needed", async () => {
    loadAtsFixture("workday/my-experience.html");
    const filled = await fillWorkdayExperience(history);

    expect(byId("workExperience-1--jobTitle").value).toBe("Senior Engineer");
    expect(byId("workExperience-1--companyName").value).toBe("Analytical Engines GmbH");
    expect(byId("workExperience-1--currentlyWorkHere").checked).toBe(true);
    expect(byId("workExperience-1--startDate-dateSectionMonth-input").value).toBe("04");
    expect(byId("workExperience-1--startDate-dateSectionYear-input").value).toBe("2021");
    expect(byId("workExperience-1--endDate-dateSectionYear-input").value).toBe(""); // current job
    expect(byId<HTMLTextAreaElement>("workExperience-1--roleDescription").value).toBe("Built the difference engine.");

    expect(byId("workExperience-2--jobTitle").value).toBe("Engineer");
    expect(byId("workExperience-2--currentlyWorkHere").checked).toBe(false);
    expect(byId("workExperience-2--endDate-dateSectionMonth-input").value).toBe("03");
    expect(byId("workExperience-2--endDate-dateSectionYear-input").value).toBe("2021");
    expect(document.querySelector("[data-automation-id='workExperience-3']")).toBeNull();

    expect(byId("education-1--schoolName").value).toBe("Universität Göttingen");
    expect(byId<HTMLButtonElement>("education-1--degree").textContent).toBe("Master's Degree");
    expect(document.querySelector("[data-automation-id='education-1'] [data-automation-id='selectedItem']")?.textContent).toBe("Mathematics");
    expect(byId("education-1--gradeAverage").value).toBe("1.3");
    expect(byId("education-1--firstYearAttended-dateSectionYear-input").value).toBe("2012");
    expect(byId("education-1--lastYearAttended-dateSectionYear-input").value).toBe("2017");

    expect(byId("webAddress-1--url").value).toBe("https://ada.dev");
    expect(filled).toBeGreaterThanOrEqual(17);
  });

  it("never overwrites an entry the user or Workday's resume parse already filled", async () => {
    loadAtsFixture("workday/my-experience.html");
    byId("workExperience-1--jobTitle").value = "Chief Engineer";
    await fillWorkdayExperience(history);
    expect(byId("workExperience-1--jobTitle").value).toBe("Chief Engineer");
  });

  it("autofill fills LinkedIn and keeps out of the repeaters; questions skip them too", async () => {
    loadAtsFixture("workday/my-experience.html");
    await autofillDocument(testProfile());
    expect(byId("socialNetworkAccounts--linkedInAccount").value).toBe("https://linkedin.com/in/ada-lovelace");
    for (const input of document.querySelectorAll<HTMLInputElement>("[data-automation-id='workExperience-1'] input[type='text']")) {
      expect(input.value).toBe("");
    }
    const questions = await detectCustomQuestions();
    expect(questions.map((q) => q.question)).toEqual([]);
  });

  it("puts the CV into the Resume/CV uploader, and the cover letter beside it (it takes several files)", () => {
    loadAtsFixture("workday/my-experience.html");
    const input = aid<HTMLInputElement>("file-upload-input-ref");
    expect(injectFileIntoPage(file("cv.pdf"), null, "cv")).toEqual({ nativeInputs: 1, dropZones: 0 });
    expect(input.files?.[0]?.name).toBe("cv.pdf");

    input.multiple = false;
    expect(injectFileIntoPage(file("letter.pdf"), null, "coverLetter").nativeInputs).toBe(0);
    expect(input.files?.[0]?.name).toBe("cv.pdf");
  });

  it("reports step 2 of 5 with Back and Save and Continue", () => {
    loadAtsFixture("workday/my-experience.html");
    expect(atsStep(document)).toMatchObject({ kind: "form", name: "My Experience", index: 2, total: 5, nextIsSubmit: false });
    expect(atsStep(document)!.back?.textContent).toBe("Back");
  });
});

describe("Workday: Application Questions (synthetic, German tenant)", () => {
  it("detects dropdown, text, split-date and prompt questions with their shapes", async () => {
    loadAtsFixture("workday/application-questions.html");
    const questions = await detectCustomQuestions();
    const by = (re: RegExp) => questions.find((q) => re.test(q.question));

    expect(by(/Arbeitserlaubnis/)?.options).toEqual(["Ja", "Nein"]);
    expect(by(/Warum möchten Sie/)).toBeDefined();
    expect(by(/frühestens beginnen/)?.dateKind).toBe("date");
    expect(by(/Jahre Berufserfahrung/)).toBeDefined();
    expect(by(/Sprachen/)).toBeDefined();
    // One question per date widget, not one per spin button.
    expect(questions.filter((q) => /beginnen|Monat|Jahr$/.test(q.question))).toHaveLength(1);
  });

  it("writes each answer through its own widget", async () => {
    loadAtsFixture("workday/application-questions.html");
    const questions = await detectCustomQuestions();
    const q = (re: RegExp) => questions.find((x) => re.test(x.question))!.question;
    const { filled, unfilled } = await fillCustomQuestionAnswers({
      [q(/Arbeitserlaubnis/)]: "Nein",
      [q(/Warum möchten Sie/)]: "Weil …",
      [q(/frühestens beginnen/)]: "2027-01-15",
      [q(/Jahre Berufserfahrung/)]: "6",
      [q(/Sprachen/)]: "Englisch",
    });

    expect(unfilled).toEqual([]);
    expect(filled).toBe(5);
    expect(byId<HTMLButtonElement>("primaryQuestionnaire--q1").textContent).toBe("Nein");
    expect(byId<HTMLTextAreaElement>("primaryQuestionnaire--q2").value).toBe("Weil …");
    expect(byId("primaryQuestionnaire--q3-dateSectionDay-input").value).toBe("15");
    expect(byId("primaryQuestionnaire--q3-dateSectionMonth-input").value).toBe("01");
    expect(byId("primaryQuestionnaire--q3-dateSectionYear-input").value).toBe("2027");
    expect(byId("primaryQuestionnaire--q4").value).toBe("6");
    expect(document.querySelector("[data-automation-id='selectedItem']")?.textContent).toBe("Englisch");
    expect(byId("primaryQuestionnaire--q5").value).toBe("");
  });

  it("sees the terms checkbox although Workday has no <form>, and ticks it on a decision", () => {
    loadAtsFixture("workday/application-questions.html");
    const boxes = detectCheckboxes();
    expect(boxes).toHaveLength(1);
    expect(boxes[0]).toMatchObject({ required: true, checked: false });
    expect(boxes[0].label).toMatch(/Datenschutzerklärung/);
    expect(applyCheckboxDecisions([{ name: "", label: boxes[0].label, check: true }])).toBe(1);
    expect(byId("termsAndConditions--acceptTermsAndAgreements").checked).toBe(true);
  });

  it("routes the cover letter to its own slot and never the CV there", () => {
    loadAtsFixture("workday/application-questions.html");
    const slot = aid<HTMLInputElement>("file-upload-input-ref");
    expect(injectFileIntoPage(file("cv.pdf"), null, "cv").nativeInputs).toBe(0);
    expect(injectFileIntoPage(file("anschreiben.pdf"), null, "coverLetter").nativeInputs).toBe(1);
    expect(slot.files?.[0]?.name).toBe("anschreiben.pdf");
  });
});

describe("Workday: account gate and flow steps (synthetic)", () => {
  it("start dialog → Apply Manually", () => {
    loadAtsFixture("workday/sign-in.html");
    showOnly("start");
    expect(atsStep(document)).toMatchObject({ kind: "start" });
    expect(atsStep(document)!.next?.textContent).toBe("Apply Manually");
  });

  it("create account: the email is filled, both password boxes get one generated password", async () => {
    loadAtsFixture("workday/sign-in.html");
    showOnly("create");
    expect(atsStep(document)).toMatchObject({ kind: "register" });
    const result = await autofillDocument(testProfile());
    expect(aid<HTMLInputElement>("email").value).toBe("ada@example.com");
    const password = aid<HTMLInputElement>("password").value;
    expect(password).not.toBe("");
    expect(aid<HTMLInputElement>("verifyPassword").value).toBe(password);
    expect(result.generatedPassword).toBe(password);
    expect(aid<HTMLInputElement>("createAccountCheckbox").checked).toBe(false);
  });

  it("sign in: never touches the password box", async () => {
    loadAtsFixture("workday/sign-in.html");
    showOnly("signin");
    expect(atsStep(document)).toMatchObject({ kind: "login" });
    const result = await autofillDocument(testProfile());
    expect(aid<HTMLInputElement>("email").value).toBe("ada@example.com");
    expect(aid<HTMLInputElement>("password").value).toBe("");
    expect(result.generatedPassword).toBeNull();
  });

  it("posting and review", () => {
    loadAtsFixture("workday/sign-in.html");
    showOnly("posting");
    expect(atsStep(document)).toMatchObject({ kind: "posting", nextIsSubmit: false });
    loadAtsFixture("workday/sign-in.html");
    showOnly("review");
    const review = atsStep(document)!;
    expect(review).toMatchObject({ kind: "review", nextIsSubmit: true, index: 5, total: 5 });
    expect(review.next?.textContent).toBe("Submit");
  });
});
