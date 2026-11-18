import { describe, expect, it } from "vitest";
import { detectCustomQuestions, fillCustomQuestionAnswers, type CustomQuestion } from "@/features/autofill/custom-questions";
import { fillAnswersByLocator } from "@/features/autofill/pick-questions";
import { applyCheckboxDecisions, detectCheckboxes } from "@/features/autofill/checkboxes";
import { checkedRadio, field, loadAtsFixture } from "./harness";

/**
 * The second half of the pass on the real forms: answers to detected questions (as the
 * Decisions/Responses API would return them) and checkbox decisions written back into the page,
 * exactly the way the Side Panel's `fillQuestionAnswers` routes them — text-keyed answers through
 * `fillCustomQuestionAnswers`, radio groups (which carry a locator) through `fillAnswersByLocator`.
 */
async function answer(answers: Record<string, string>): Promise<{ questions: CustomQuestion[]; unfilled: string[] }> {
  const questions = await detectCustomQuestions();
  const byText: Record<string, string> = {};
  const byLocator: Parameters<typeof fillAnswersByLocator>[0] = [];
  for (const [prefix, value] of Object.entries(answers)) {
    const q = questions.find((q) => q.question.startsWith(prefix));
    if (!q) throw new Error(`no question "${prefix}" among ${questions.map((x) => x.question).join(" | ")}`);
    if (q.options) expect(q.options).toContain(value);
    if (q.locator) byLocator.push({ locator: q.locator, answer: value, question: q.question });
    else byText[q.question] = value;
  }
  const text = await fillCustomQuestionAnswers(byText);
  const located = await fillAnswersByLocator(byLocator);
  return { questions, unfilled: [...text.unfilled, ...located.unfilled] };
}

function consent(substring: string): void {
  const box = detectCheckboxes().find((c) => c.label.includes(substring));
  if (!box) throw new Error(`no checkbox "${substring}"`);
  expect(box.checked).toBe(false);
  expect(applyCheckboxDecisions([{ name: box.name, label: box.label, check: true }])).toBe(1);
}

describe("answers on real ATS forms", () => {
  it("d.vinci: select2 questions take an option, Ja/Nein radio questions a radio", async () => {
    loadAtsFixture("dvinci", "heo-senior-director-it.html");
    const { unfilled } = await answer({
      "Deutschkenntnisse": "Muttersprachliches Niveau",
      "Englischkenntnisse": "C1 – Spontane und komplexe Sprachsituationen meistern",
      "Liegt eine EU-Arbeitserlaubnis vor?": "Ja",
      "Mobilität nach Herxheim": "Nein",
      "Datenschutzhinweise für Bewerberinnen und Bewerber": "Ja",
      "Staatsangehörigkeit": "britisch",
    });
    expect(unfilled).toEqual([]);
    expect((field("screeningQuestion.5") as HTMLSelectElement).selectedOptions[0].textContent).toBe("Muttersprachliches Niveau");
    expect((field("screeningQuestion.6") as HTMLSelectElement).selectedOptions[0].textContent).toMatch(/^C1/);
    expect(checkedRadio("screeningQuestion.65")).toBe("1");
    expect(checkedRadio("privacyPolicyAccepted")).not.toBe("");
    expect((field("screeningQuestion.66") as HTMLInputElement).value).toBe("britisch");
  });

  it("d.vinci: the select2 facade and its select are asked once", async () => {
    loadAtsFixture("dvinci", "heo-senior-director-it.html");
    const questions = (await detectCustomQuestions()).map((q) => q.question);
    expect(questions.filter((q) => q.startsWith("Deutschkenntnisse"))).toHaveLength(1);
    expect(questions.some((q) => q.includes("Bitte wählen"))).toBe(false);
  });

  it("rexx: a selectmenu question sets the hidden select and repaints the facade; consent is ticked", async () => {
    loadAtsFixture("rexx", "nobix-bilanzbuchhalter.html");
    const { unfilled } = await answer({ "Wie haben Sie uns gefunden?": "Homepage", "Berufserfahrung": "3-5 Jahre" });
    expect(unfilled).toEqual([]);
    const source = field("bewerbung_form[wie_gefunden]") as HTMLSelectElement;
    expect(source.selectedOptions[0].textContent).toBe("Homepage");
    expect(document.querySelector("#wie_gefunden-button .ui-selectmenu-text")?.textContent).toBe("Homepage");
    consent("Ich akzeptiere die elektronische Speicherung");
    expect((field("#agb_checkbox") as HTMLInputElement).checked).toBe(true);
  });

  it("umantis: the data-retention radio question and the privacy checkbox", async () => {
    loadAtsFixture("umantis", "recruitingapp-5608.html");
    const { unfilled } = await answer({
      Datenfreigabe: "Ich möchte, dass meine Daten nach dem aktuellen Bewerbungsverfahren gelöscht werden.",
      "Wie sind Sie auf uns aufmerksam geworden?": "Homepage der Unternehmung",
    });
    expect(unfilled).toEqual([]);
    expect(checkedRadio("form_data38")).toBe("DataAgree_No");
    consent("Datenschutzerklärung");
    expect((field("form_data41") as HTMLInputElement).checked).toBe(true);
  });

  it("concludis: the start-date radios, then step 2's referral question", async () => {
    loadAtsFixture("concludis", "cellitinnen-pflegefachkraft.html");
    const { unfilled } = await answer({ Verfügbarkeit: "Ab sofort" });
    expect(unfilled).toEqual([]);
    expect(checkedRadio("disposability_type")).toBe("0");
  });
});
