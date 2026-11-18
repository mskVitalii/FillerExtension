import { describeAtsCase } from "./ats-suite";

/**
 * Greenhouse (job-boards.greenhouse.io, the EU instance, and the `grnhse_iframe` embed, which now
 * serves the same React form from job-boards.greenhouse.io/embed/job_app). Snapshots: see README.md.
 */

const SALARY = /^65[.,]?000$/;
const PHONE_CODE_EN = "Germany +49";

const standard = (countryOption = PHONE_CODE_EN) => [
  { sel: "#first_name", want: "Ada", label: "first name" },
  { sel: "#last_name", want: "Lovelace", label: "last name" },
  { sel: "#email", want: "ada@example.com", label: "email" },
  { sel: "#country", want: countryOption, label: "phone country code" },
  { sel: "#phone", want: "1745624691", label: "phone (national part)" },
];

describeAtsCase({
  ats: "greenhouse",
  fixture: "celonis-en",
  fields: [
    ...standard(),
    { sel: "#question_33205727003", want: "https://linkedin.com/in/ada-lovelace", label: "LinkedIn Profile" },
    { sel: "#question_33205730003", want: SALARY, label: "Salary Expectation" },
  ],
  files: { cv: "#resume", coverLetter: "#cover_letter" },
  questions: [
    "Most Recent Employer",
    "Most Recent Job Title",
    "legally authorized to work",
    "immigration sponsorship",
    "speak German fluently",
    "German Bundeswehr",
    "Notice Period",
    "How did you hear about this job",
    "Celonis Privacy Notice",
    "information provided in this application",
  ],
  notQuestions: ["gender identity", "The Best Team Wins", "first name", "email", "linkedin", "salary"],
  questionOptions: { "legally authorized to work": ["Yes", "No"] },
  answerDropdown: { question: "immigration sponsorship", answer: "No", sel: "#question_33205729003", want: "No" },
  checkboxes: [],
  notCheckboxes: ["consent to Celonis collecting"],
});

describeAtsCase({
  ats: "greenhouse",
  fixture: "flix-de-embed",
  fields: [
    ...standard("Deutschland +49"),
    { sel: "#question_38051868002", want: SALARY, label: "Gehaltsvorstellungen" },
  ],
  files: { cv: "#resume", coverLetter: null },
  questions: ["01.01.2027", "Deutsch-Kenntnisse", "Arbeitserlaubnis", "deutschlandweiten Einsatz", "Wie hast du über die Position"],
  notQuestions: ["Gehaltsvorstellungen", "Vorname", "Nachname"],
  questionOptions: { "Deutsch-Kenntnisse": ["Grundkenntnisse (A1-A2)", "Ausbaufähig (B1-B2)", "Verhandlungssicher (C1-C2)"] },
  answerDropdown: { question: "Arbeitserlaubnis", answer: "Ja", sel: "#question_38051869002", want: "Ja" },
  checkboxes: [],
});

describeAtsCase({
  ats: "greenhouse",
  fixture: "n26-en-embed",
  fields: [
    ...standard(),
    { sel: "#candidate-location", want: "Berlin, Germany", label: "Location (City) autocomplete" },
    { sel: "#question_69534721", want: "https://linkedin.com/in/ada-lovelace", label: "LinkedIn Profile / Website" },
    { sel: "#question_69534726", want: SALARY, label: "salary expectations" },
  ],
  files: { cv: "#resume", coverLetter: "#cover_letter" },
  questions: ["Art. 13 GDPR", "currently based", "immigration case", "notice period in Months", "professional references", "relatives"],
  notQuestions: ["Location (City)", "salary expectations", "LinkedIn"],
  answerDropdown: { question: "relatives or domestic partners", answer: "No", sel: "#question_69895063", want: "No" },
  checkboxes: [],
});

describeAtsCase({
  ats: "greenhouse",
  fixture: "raisin-en-eu",
  fields: [
    ...standard(),
    { sel: "#question_9465832101", want: "https://linkedin.com/in/ada-lovelace", label: "LinkedIn or Xing Profile" },
    { sel: "#question_9465836101", want: SALARY, label: "salary expectations" },
  ],
  // "Preferred First Name" may take the first name; leaving it empty is fine too.
  tolerated: ["#preferred_name"],
  files: { cv: "#resume", coverLetter: "#cover_letter" },
  questions: ["when you could start", "work authorisation status", "languages do you speak", "anything else you would like to share"],
  notQuestions: ["salary", "LinkedIn"],
  questionOptions: { "work authorisation status": ["Citizen", "Permanent Resident", "Work Permit/ Work Visa", "Requires Sponsorship"] },
  checkboxes: [],
  // The location checkboxes are a multiple-choice question, not consent.
  notCheckboxes: ["Within Germany", "Within the EU"],
  optionQuestions: [
    {
      container: () => document.getElementById("question_9465833101[]"),
      question: /What is your current location\?/,
      options: ["Within Germany", "Within the EU", "None of the above"],
      answer: "Within Germany",
      check: () =>
        (document.getElementById("question_9465833101[]_70109318101") as HTMLInputElement).checked &&
        !(document.getElementById("question_9465833101[]_70109319101") as HTMLInputElement).checked,
    },
  ],
});
