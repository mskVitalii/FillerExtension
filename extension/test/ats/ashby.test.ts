import { describeAtsCase } from "./ats-suite";

/** Ashby (jobs.ashbyhq.com/<org>/<id>/application). Snapshots: see README.md. */

const entry = (path: string) => `[data-field-path="${path}"]`;
const input = (path: string) => `${entry(path)} input:not([type="file"]), ${entry(path)} textarea`;
const container = (path: string) => () => document.querySelector<HTMLElement>(entry(path));
const PHONE = /^\+49 ?174 ?5624691$/;
const LOCATION = "Berlin, Germany";
const LINKEDIN = "https://linkedin.com/in/ada-lovelace";
const pressed = (path: string, option: "yes" | "no") =>
  document.querySelector(`${entry(path)} [data-option="${option}"]`)?.getAttribute("aria-pressed") === "true";
const radioChecked = (path: string, label: string) =>
  Array.from(document.querySelectorAll<HTMLInputElement>(`${entry(path)} input[type="radio"]`)).some(
    (r) => r.checked && document.querySelector(`label[for="${CSS.escape(r.id)}"]`)?.textContent === label,
  );

describeAtsCase({
  ats: "ashby",
  fixture: "enpal-de",
  fields: [
    { sel: "#_systemfield_name", want: "Ada Lovelace", label: "Name" },
    { sel: "#_systemfield_email", want: "ada@example.com", label: "Email" },
    { sel: 'input[type="tel"]', want: PHONE, label: "Number (tel)" },
    { sel: input("_systemfield_location"), want: LOCATION, label: "Location autocomplete" },
    { sel: input("3b24f670-c235-4d56-a109-2163a9205ed2"), want: LINKEDIN, label: "LinkedIn Profile" },
    { sel: input("0a8c9df0-d6a9-4cab-aac4-c3f97fcc46d5"), want: "65000", label: "target annual salary (number)" },
  ],
  files: { cv: "#_systemfield_resume", coverLetter: null },
  questions: ["earliest possible starting date"],
  notQuestions: ["target annual salary", "LinkedIn", "Location"],
  checkboxes: ["I agree"],
  optionQuestions: [
    {
      container: container("5549a960-bb53-45d9-b4c5-0c5bd48c6162"),
      question: /worked at Enpal before/,
      options: ["Yes", "No"],
      answer: "No",
      check: () => pressed("5549a960-bb53-45d9-b4c5-0c5bd48c6162", "no") && !pressed("5549a960-bb53-45d9-b4c5-0c5bd48c6162", "yes"),
    },
    {
      container: container("771588bb-b40d-48d1-a08e-da46671ceb89"),
      question: /english language skills/,
      options: ["C2", "C1", "B2", "B1", "A"],
      answer: "C1",
      check: () => radioChecked("771588bb-b40d-48d1-a08e-da46671ceb89", "C1"),
    },
  ],
});

describeAtsCase({
  ats: "ashby",
  fixture: "n8n-en",
  fields: [
    { sel: "#_systemfield_name", want: "Ada Lovelace", label: "First and last name" },
    { sel: "#_systemfield_email", want: "ada@example.com", label: "Email" },
    { sel: input("5e07ba5e-3f7a-41dc-9679-c566d92e66a7"), want: LINKEDIN, label: "Linkedin (link)" },
    { sel: input("_systemfield_location"), want: LOCATION, label: "preferred main location (system location field)" },
    { sel: input("0cbcad9f-b8b0-41d7-965c-e00a1af9fc70"), want: /^65[.,]?000$/, label: "expected yearly salary" },
  ],
  files: { cv: "#_systemfield_resume", coverLetter: null },
  questions: ["Notice period / availability details", "caught your attention", "led or significantly contributed to a security initiative"],
  notQuestions: ["current age", "gender identity", "transgender", "sexual orientation", "ethnicity", "communities", "First and last name"],
  checkboxes: ["I agree"],
  // Multiple-choice options and the voluntary diversity survey are not consent checkboxes.
  notCheckboxes: ["Bisexual", "Person with disability", "Cloud-native SaaS platform", "based in Germany"],
  optionQuestions: [
    {
      container: container("0687a61c-f445-4a71-acf1-e4cf0e774bb3"),
      question: /sizes of companies/,
      options: [
        "Mostly small or early-stage companies (under 50 people)",
        "Mostly small to mid-sized companies (50–200 people)",
        "Mid-sized or growth-stage companies (200–1,000 people)",
        "Established companies (1,000+ people)",
        "Large-scale companies (5,000+ people)",
      ],
      answer: "Mostly small to mid-sized companies (50–200 people)",
      check: () => radioChecked("0687a61c-f445-4a71-acf1-e4cf0e774bb3", "Mostly small to mid-sized companies (50–200 people)"),
    },
  ],
});

describeAtsCase({
  ats: "ashby",
  fixture: "parloa-en",
  fields: [
    { sel: "#_systemfield_name", want: "Ada Lovelace", label: "Full Name" },
    { sel: "#_systemfield_email", want: "ada@example.com", label: "Email Address" },
    { sel: 'input[type="tel"]', want: PHONE, label: "Phone Number" },
    { sel: input("2c121921-15b5-4040-9f2d-85430bb6d30b"), want: LINKEDIN, label: "LinkedIn Profile URL" },
    { sel: input("_systemfield_location"), want: LOCATION, label: "Location autocomplete" },
    { sel: input("5ae733bb-9561-4776-a13b-66cb2c4786f9"), want: /^65[.,]?000$/, label: "salary expectations" },
  ],
  files: { cv: "#_systemfield_resume", coverLetter: null },
  questions: ["preferred name", "AI agent or LLM feature", "integration you built", "Where would you like to work from", "earliest possible start date"],
  notQuestions: ["salary expectations", "LinkedIn", "Full Name"],
  questionOptions: {
    "Where would you like to work from": [
      "Berlin",
      "Munich",
      "London",
      "Paris",
      "Madrid",
      "Milan",
      "Remotely in Germany",
      "Remotely in Europe",
      "Remotely in the UK",
      "Remotely in France",
      "Remotely in Spain",
      "Remotely in Italy",
      "None of the above",
    ],
  },
  answerDropdown: { question: "Where would you like to work from", answer: "Berlin", sel: input("73e403ea-f5ad-4071-beba-e73e802a3e81"), want: "Berlin" },
  checkboxes: ["I agree"],
  optionQuestions: [
    {
      container: container("8d1cdb33-939c-40f8-9ff4-5ffc8837cf61"),
      question: /legally eligible to work/,
      options: ["Yes", "No"],
      answer: "Yes",
      check: () => pressed("8d1cdb33-939c-40f8-9ff4-5ffc8837cf61", "yes"),
    },
  ],
});
