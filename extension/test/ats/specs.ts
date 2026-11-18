import type { FixtureSpec } from "./harness";

/**
 * Expected end states for every real-form snapshot in `test/ats/<ats>/` (see `harness.ts`).
 * Applicant: `test/fixtures.ts#testProfile` — Ms Ada Lovelace, 12 Analytical Engine Ave,
 * 10115 Berlin, Germany, phone 1745624691, salary 65000.
 */

const ADA_PHONE = "+491745624691";
const STREET = "12 Analytical Engine Ave";

const REXX_PERSON = {
  "bewerbung_form[vorname]": "Ada",
  "bewerbung_form[nachname]": "Lovelace",
  "bewerbung_form[strasse]": STREET,
  "bewerbung_form[plz]": "10115",
  "bewerbung_form[ort]": "Berlin",
  "bewerbung_form[telefon]": ADA_PHONE,
  "bewerbung_form[mail]": "ada@example.com",
  // "Anrede"/"Geschlecht" → the native select behind the jQuery UI selectmenu.
  "bewerbung_form[gender]": "GENDER_FEMALE",
};
const REXX_GERMANY = "VORGABEWERT_799aa285cec4005187038";
/** The aria-hidden honeypot, the academic title, the CV-parser upload. */
const REXX_UNTOUCHED = ["website", "bewerbung_form[titel]", "bewerbung_form[geburtsdatum]"];
const REXX_CONSENT = "Ich akzeptiere die elektronische Speicherung meiner Daten";

export const SPECS: Record<string, FixtureSpec[]> = {
  dvinci: [
    {
      file: "heo-senior-director-it.html",
      filled: {
        salutation: "MS",
        firstName: "Ada",
        lastName: "Lovelace",
        countryIsoA2: "DE",
        address2: STREET, // labelled "Straße"
        zipCode: "10115",
        city: "Berlin",
        email: "ada@example.com",
        telephone: ADA_PHONE,
        desiredSalary: "65000",
      },
      // "Titel" (Dr./Prof.), "Adresszusatz" (named address1), the second phone.
      untouched: ["title", "address1", "alternativeTelephone", "dateOfBirth", "comment"],
      questions: [
        "Frühestmöglicher Beginn",
        "Deutschkenntnisse",
        "Englischkenntnisse",
        "Staatsangehörigkeit",
        "Wie bist du auf uns aufmerksam geworden?",
        "Mobilität nach Herxheim",
        "Liegt eine EU-Arbeitserlaubnis vor?",
        "Empfehlung heo Mitarbeitenden",
        "Datenschutzhinweise für Bewerberinnen und Bewerber",
        "Ich bin damit einverstanden, dass meine Unterlagen",
      ],
      notQuestions: ["Anrede", "Land", "E-Mail", "Gehaltsvorstellung"],
      files: { cv: ["attachmentFile"], coverLetter: ["attachmentFile"], never: ["photoFile"] },
    },
    {
      file: "msg-services-aws-architect.html",
      filled: {
        salutation: "MS",
        firstName: "Ada",
        lastName: "Lovelace",
        countryIsoA2: "DE",
        email: "ada@example.com",
        telephone: ADA_PHONE,
        "screeningQuestion.7": "65000", // "Gehaltsvorstellung:" as a screening question
      },
      untouched: ["comment"],
      questions: ["Ich habe von dem Unternehmen durch den folgenden Kanal erfahren", "allgemeine Datenschutzerklärung"],
      files: { cv: ["attachmentFile"], coverLetter: ["attachmentFile"], never: [] },
    },
    {
      file: "noventi-produktmanager.html",
      filled: {
        salutation: "MS",
        firstName: "Ada",
        lastName: "Lovelace",
        countryIsoA2: "DE",
        address2: STREET,
        zipCode: "10115",
        city: "Berlin",
        email: "ada@example.com",
        telephone: ADA_PHONE,
        desiredSalary: "65000",
      },
      // "Vor- und Nachname des Mitarbeiters (m/w/d)" — the referring employee, not the applicant.
      untouched: ["title", "address1", "screeningQuestion.2", "dateOfBirth"],
      questions: [
        "Frühestmöglicher Beginn",
        "Weiterempfehlung durch einen Mitarbeiter",
        "Ich habe von dem Unternehmen durch den folgenden Kanal erfahren",
        "Information über die Erhebung und Verarbeitung",
      ],
      files: { cv: ["attachmentFile"], coverLetter: ["attachmentFile"], never: [] },
    },
  ],

  rexx: [
    {
      file: "horiba-inhouse-sales.html",
      filled: { ...REXX_PERSON, "bewerbung_form[country]": REXX_GERMANY, "bewerbung_form[gehaltswunsch]": "65000" },
      untouched: [...REXX_UNTOUCHED, "bewerbung_form[erfahrung_ausland]"],
      facadeText: { "#gender-button": "Frau", "#country-button": "Deutschland" },
      questions: ["Schulabschluss", "Berufserfahrung", "Frühester Eintritt", "Wie haben Sie uns gefunden?", "Auslandserfahrung"],
      notQuestions: ["Website", "Land", "Anrede"],
      checkboxes: [REXX_CONSENT],
      // No "Lebenslauf" slot: the CV goes into "Anschreiben / Komplette Unterlagen", and the
      // cover letter doesn't replace it there.
      files: { cv: ["anschreiben"], coverLetter: [], never: ["cv_lebenslauf", "foto", "anlage1", "anlage3", "anlage5"] },
    },
    {
      file: "ifa-depotverwaltung.html",
      filled: { ...REXX_PERSON, "bewerbung_form[country]": REXX_GERMANY },
      untouched: REXX_UNTOUCHED,
      facadeText: { "#country-button": "Deutschland" },
      questions: ["Geburtsdatum", "Schwerbehinderung vorhanden", "Höchster Studien/Berufsabschluss", "Berufserfahrung"],
      notQuestions: ["Website"],
      checkboxes: [REXX_CONSENT],
      files: { cv: ["anlage7"], coverLetter: [], never: ["cv_lebenslauf", "foto"] },
    },
    {
      file: "nobix-bilanzbuchhalter.html",
      filled: { ...REXX_PERSON, "bewerbung_form[country]": REXX_GERMANY, "bewerbung_form[gehaltswunsch]": "65000" },
      untouched: REXX_UNTOUCHED,
      facadeText: { "#gender-button": "Frau" },
      questions: ["Schulabschluss", "Berufserfahrung", "Frühester Eintritt", "Testfeld", "Wie haben Sie uns gefunden?", "ERP-Erfahrung"],
      notQuestions: ["Website"],
      checkboxes: [REXX_CONSENT],
      files: { cv: ["lebenslauf"], coverLetter: ["anschreiben"], never: ["cv_lebenslauf", "foto", "anlage1", "anlage3", "anlage5"] },
    },
    {
      file: "rexx-systems-junior-sales.html",
      filled: { ...REXX_PERSON, "bewerbung_form[gehaltswunsch]": "65000" },
      untouched: REXX_UNTOUCHED,
      questions: ["Geburtsdatum", "Schulabschluss", "Berufserfahrung", "Deutsch", "Englisch", "Frühester Eintritt", "Wie hast Du uns gefunden?"],
      notQuestions: ["Website", "Suche"],
      checkboxes: ["Verarbeitung Deiner Bewerbungsdaten"],
      files: { cv: ["lebenslauf"], coverLetter: ["anschreiben"], never: ["cv_lebenslauf", "foto", "anlage1", "anlage2", "anlage5"] },
    },
  ],

  umantis: [
    {
      file: "recruitingapp-5608.html",
      filled: {
        form_data8: "Ada",
        form_data9: "Lovelace",
        form_data11: "ada@example.com", // "E-Mail-Adresse/Login"
        form_data17: ADA_PHONE,
        form_data18: "https://linkedin.com/in/ada-lovelace",
        form_data31: "65000",
      },
      radios: { form_data6: "Salutation_F" },
      untouched: ["form_data7", "form_data19"], // "Titel", "XING-Profil"
      questions: ["Warum möchten Sie bei uns arbeiten?", "Wie sind Sie auf uns aufmerksam geworden?", "Datenfreigabe"],
      checkboxes: ["Ich bin mit der Datenschutzerklärung einverstanden"],
      files: { cv: ["form_data23"], coverLetter: [], never: ["form_data5", "form_data24", "form_data25", "form_data26"] },
    },
    {
      file: "yamaha-music.html",
      filled: {
        form_data8: "Ada",
        form_data9: "Lovelace",
        form_data11: STREET,
        form_data12: "10115",
        form_data13: "Berlin",
        form_data14: "22001", // Germany
        form_data15: ADA_PHONE,
        form_data17: "https://linkedin.com/in/ada-lovelace",
        form_data19: "ada@example.com",
        form_data32: "65000", // "Desired annual salary"
      },
      radios: { form_data6: "Salutation_F" },
      untouched: ["form_data7", "form_data16"], // "Title" (free text), "XING profile"
      questions: ["Date of birth", "Expected start date", "How did you hear about us?"],
      checkboxes: ["I agree to the Privacy Policy Statement"],
      files: { cv: ["form_data26"], coverLetter: ["form_data27"], never: ["form_data5", "form_data28", "form_data29", "form_data30"] },
    },
  ],

  concludis: [
    concludisSpec("amazone-ausbildung.html", []),
    concludisSpec("cellitinnen-pflegefachkraft.html", ["Verfügbarkeit"], { mobile: ADA_PHONE }),
    concludisSpec("cellitinnen-stv-leitung.html", ["Verfügbarkeit"], { mobile: ADA_PHONE }),
  ],
};

function concludisSpec(file: string, questions: string[], extra: Record<string, string> = {}): FixtureSpec {
  const twoStep = file.startsWith("cellitinnen");
  return {
    file,
    filled: {
      sex: "f",
      FirstName: "Ada",
      LastName: "Lovelace",
      street: STREET,
      PLZ: "10115",
      ort: "Berlin",
      CC: "DE",
      email: "ada@example.com",
      tel: ADA_PHONE,
      KarGehalt: "65000",
      // The salary's currency and period selects keep their defaults.
      currency_KarGehalt: "EUR",
      expected_salary_periode: "j",
      ...extra,
    },
    untouched: ["title"],
    questions,
    notQuestions: ["Gehaltsvorstellung"],
    files: { cv: ["uploadfile"], coverLetter: [], never: [] },
    nextStep: () => showConcludisFinalStep(),
    afterNextStep: twoStep
      ? { questions: ["Diese Stelle wurde mir durch eine Mitarbeiterin oder einen Mitarbeiter empfohlen"], checkboxes: ["Datenschutz"] }
      : { checkboxes: ["Datenschutzbestimmungen gelesen"] },
  };
}

/** What concludis' "Weiter" does: hide the current step, show the next one. */
function showConcludisFinalStep(): void {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".form-section"));
  for (const section of sections) {
    section.classList.remove("current");
    section.setAttribute("data-fx-hidden", "");
  }
  const last = sections[sections.length - 1];
  last?.classList.add("current");
  last?.removeAttribute("data-fx-hidden");
}
