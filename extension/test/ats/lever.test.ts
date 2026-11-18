import { describeAtsCase } from "./ats-suite";

/** Lever (jobs.lever.co/<company>/<id>/apply). Snapshots: see README.md. */

const PHONE = /^\+49 ?174 ?5624691$/;
const LOCATION = "Berlin, DEU";
const LINKEDIN = "https://linkedin.com/in/ada-lovelace";

const card = (uuid: string) => `[name="cards[${uuid}][field0]"]`;
const question = (uuid: string) => () => document.querySelector(card(uuid))?.closest<HTMLElement>(".application-question") ?? null;
const checked = (sel: string) => (document.querySelector(sel) as HTMLInputElement | null)?.checked === true;

describeAtsCase({
  ats: "lever",
  fixture: "agicap-en",
  fields: [
    { sel: '[name="name"]', want: "Ada Lovelace", label: "Full name" },
    { sel: '[name="email"]', want: "ada@example.com", label: "Email" },
    { sel: '[name="phone"]', want: PHONE, label: "Phone" },
    { sel: '[name="location"]', want: LOCATION, label: "Current location" },
    { sel: '[name="urls[LinkedIn]"]', want: LINKEDIN, label: "LinkedIn URL" },
    { sel: '[name="urls[Other]"]', want: "https://ada.dev", label: "Other website" },
  ],
  files: { cv: "#resume-upload-input", coverLetter: null },
  questions: [],
  notQuestions: ["Full name", "Email", "LinkedIn", "website", "location"],
  checkboxes: ["contact me about future job opportunities"],
  optionQuestions: [
    {
      container: question("92ce11d9-aec7-4be6-9c97-1a79dc85c5b8"),
      question: /level of German/,
      options: ["Native/Bilingual", "Professional", "Intermediate", "Beginner"],
      answer: "Professional",
      check: () => checked(`${card("92ce11d9-aec7-4be6-9c97-1a79dc85c5b8")}[value="Professional"]`),
    },
  ],
});

describeAtsCase({
  ats: "lever",
  fixture: "finn-de",
  fields: [
    { sel: '[name="name"]', want: "Ada Lovelace", label: "Full name" },
    { sel: '[name="email"]', want: "ada@example.com", label: "Email" },
    { sel: '[name="phone"]', want: PHONE, label: "Phone" },
    { sel: '[name="location"]', want: LOCATION, label: "Current location" },
    { sel: '[name="urls[LinkedIn]"]', want: LINKEDIN, label: "LinkedIn URL" },
    { sel: card("7e183adc-40dd-4631-b696-fc243ddca4d5"), want: /^65[.,]?000$/, label: "Gehaltsvorstellung (card)" },
  ],
  files: { cv: "#resume-upload-input", coverLetter: null },
  questions: ["frühestes Startdatum", "Hochglanzjob", "Wo hast du von dieser Position gehört"],
  notQuestions: ["Gehaltsvorstellung", "Full name", "LinkedIn"],
  questionOptions: {
    "Wo hast du von dieser Position gehört": [
      "Select...",
      "LinkedIn",
      "Indeed",
      "StepStone",
      "Startup Insider",
      "Freund:innen / Bekannte",
      "Social Media",
      "Werbung",
      "Ich war auf der Suche nach einem AutoAbo",
      "Xing",
      "Uni-Plattformen",
      "Andere",
    ],
  },
  checkboxes: [],
  optionQuestions: [
    {
      container: question("fd781de0-180e-4c3b-a53b-57f84d63bba9"),
      question: /\?/,
      options: ["Ja", "Nein"],
      answer: "Ja",
      check: () => checked(`${card("fd781de0-180e-4c3b-a53b-57f84d63bba9")}[value="Ja"]`),
    },
  ],
});

describeAtsCase({
  ats: "lever",
  fixture: "sysdig-dach-en",
  fields: [
    { sel: '[name="name"]', want: "Ada Lovelace", label: "Full name" },
    { sel: '[name="email"]', want: "ada@example.com", label: "Email" },
    { sel: '[name="phone"]', want: PHONE, label: "Phone" },
    { sel: '[name="location"]', want: LOCATION, label: "Current location" },
    { sel: '[name="urls[LinkedIn]"]', want: LINKEDIN, label: "LinkedIn URL" },
    { sel: '[name="urls[GitHub]"]', want: "https://github.com/ada", label: "GitHub URL" },
    { sel: '[name="urls[Portfolio]"]', want: "https://ada.dev", label: "Portfolio URL" },
    { sel: '[name="urls[Website ]"]', want: "https://ada.dev", label: "Other website" },
  ],
  files: { cv: "#resume-upload-input", coverLetter: card("2b91c9dd-2899-4603-ab9f-b5218e738b4a") },
  questions: ["How did you hear about this job", "currently authorized to work", "renewal or sponsorship"],
  notQuestions: ["Gender", "Race", "Veteran", "Twitter"],
  questionOptions: { "currently authorized to work": ["Select...", "Yes", "No"] },
  checkboxes: ["proof of your right to work", "background check", "Applicant Privacy Notice"],
  notCheckboxes: ["veteran"],
});

describeAtsCase({
  ats: "lever",
  fixture: "spotify-gsa-en",
  fields: [
    { sel: '[name="name"]', want: "Ada Lovelace", label: "Full name" },
    { sel: '[name="email"]', want: "ada@example.com", label: "Email" },
    { sel: '[name="phone"]', want: PHONE, label: "Phone" },
    { sel: '[name="location"]', want: LOCATION, label: "Current location" },
    { sel: '[name="urls[LinkedIn]"]', want: LINKEDIN, label: "LinkedIn URL" },
    { sel: '[name="urls[GitHub]"]', want: "https://github.com/ada", label: "GitHub URL" },
    { sel: '[name="urls[Portfolio]"]', want: "https://ada.dev", label: "Portfolio URL" },
    { sel: '[name="urls[Other]"]', want: "https://ada.dev", label: "Other website" },
  ],
  files: { cv: "#resume-upload-input", coverLetter: null },
  questions: ["Current company"],
  notQuestions: ["What is your location"],
  checkboxes: ["contact me about future job opportunities"],
  notCheckboxes: ["Yes - Intern", "Yes - Full Time Employment"],
  optionQuestions: [
    {
      container: question("92a51f92-d683-4f7b-be57-e25376f60abe"),
      question: /\w/,
      options: ["No", "Yes - Intern", "Yes - Full Time Employment"],
      answer: "No",
      check: () => checked(`${card("92a51f92-d683-4f7b-be57-e25376f60abe")}[value="No"]`),
    },
  ],
});
