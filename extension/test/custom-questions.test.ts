import { beforeEach, describe, expect, it } from "vitest";
import { detectCustomQuestions, fillCustomQuestionAnswers, questionAnswerKey } from "@/features/autofill/custom-questions";
import { loadFixture } from "./load-fixture";

describe("automatic custom-question detection and fill (Application questions section)", () => {
  beforeEach(() => {
    loadFixture();
  });

  it("detects the 7 question-shaped fields and none of the plain profile fields", async () => {
    const questions = (await detectCustomQuestions()).map((q) => q.question);
    expect(questions).toEqual(
      expect.arrayContaining([
        "Waren Sie bereits bei der AVL Gruppe beschäftigt?",
        "Aktueller oder letzter Arbeitgeber",
        "Bei Mitarbeiterempfehlung bitte den/die Namen angeben",
        // Its own wrapping <label> text wins over its (German) aria-label —
        // same label-beats-aria-label priority as everywhere else in the
        // codebase (field-detector.ts, field-signal.ts).
        "Preferred entry date / period of notice",
        "Select your level",
        "Wie viele Jahre Berufserfahrung haben Sie?",
        "Wann wäre Ihr frühestmöglicher Startdatum?",
      ]),
    );
    // A plain profile field (e.g. "First name") must never show up here —
    // that's Autofill's job, not the question-answer pipeline's.
    expect(questions.some((q) => /first name/i.test(q))).toBe(false);
  });

  it("detects a required <select> question with its option labels (Stepstone-style dropdown, e.g. language level) and fills it by matching an option's text", async () => {
    const detected = (await detectCustomQuestions()).find((q) => q.question === "Select your level");
    expect(detected?.options).toEqual(["Beginner", "Intermediate", "Advanced", "Fluent", "Native"]);

    const { filled } = await fillCustomQuestionAnswers({ "Select your level": "Advanced" });
    expect(filled).toBe(1);
    expect(qs<HTMLSelectElement>("#lang-level").value).toBe("2");
  });

  it("flags a required <input type=\"number\"> question as numeric, and coerces a messy AI answer into a value the browser actually accepts", async () => {
    const detected = (await detectCustomQuestions()).find((q) => q.question === "Wie viele Jahre Berufserfahrung haben Sie?");
    expect(detected?.numeric).toBe(true);

    // The model was told to answer with a bare number, but even a stray
    // unit/prose it slips in anyway must not leave the required field
    // empty — `<input type="number">`'s native value setter would otherwise
    // silently reset a non-numeric string to "".
    const { filled } = await fillCustomQuestionAnswers({ "Wie viele Jahre Berufserfahrung haben Sie?": "ca. 5 Jahre" });
    expect(filled).toBe(1);
    expect(qs<HTMLInputElement>('[aria-label="Wie viele Jahre Berufserfahrung haben Sie?"]').value).toBe("5");
  });

  it("flags a required <input type=\"date\"> question with its date kind, and coerces a notice-period-shaped AI answer into yyyy-MM-dd", async () => {
    const detected = (await detectCustomQuestions()).find((q) => q.question === "Wann wäre Ihr frühestmöglicher Startdatum?");
    expect(detected?.dateKind).toBe("date");

    // Reported live on Stepstone: the model answered with a description of
    // the notice period instead of a computed calendar date. Even that
    // must not leave the required field empty — `<input type="date">`'s
    // native value setter silently resets anything not in "yyyy-MM-dd" to
    // "". This exercises the fill-time safety net specifically (the
    // generation-side DATE_RULE in answer-question.ts is what should stop
    // the model from doing this in the first place, but isn't reachable
    // from a unit test that doesn't call the OpenAI API) — a value this
    // deterministic parser genuinely can't resolve is expected to fail,
    // which is exactly what happens here since no date is even implied.
    const { filled } = await fillCustomQuestionAnswers({
      "Wann wäre Ihr frühestmöglicher Startdatum?": "Mit einer Kündigungsfrist von einem Monat.",
    });
    expect(filled).toBe(0);
    expect(qs<HTMLInputElement>('[aria-label="Wann wäre Ihr frühestmöglicher Startdatum?"]').value).toBe("");

    // An answer that does resolve to a real date, in the German shape the
    // model tends to fall back to on a German-language form, still fills.
    const { filled: filledDe } = await fillCustomQuestionAnswers({
      "Wann wäre Ihr frühestmöglicher Startdatum?": "01.03.2026",
    });
    expect(filledDe).toBe(1);
    expect(qs<HTMLInputElement>('[aria-label="Wann wäre Ihr frühestmöglicher Startdatum?"]').value).toBe(
      "2026-03-01",
    );
  });

  it("writes each answer into its own field, matched by question text", async () => {
    const answers: Record<string, string> = {
      "Waren Sie bereits bei der AVL Gruppe beschäftigt?": "Nein",
      "Aktueller oder letzter Arbeitgeber": "Acme GmbH",
    };
    const { filled } = await fillCustomQuestionAnswers(answers);
    expect(filled).toBe(2);
    expect(qs<HTMLInputElement>('[aria-label="Waren Sie bereits bei der AVL Gruppe beschäftigt?"]').value).toBe("Nein");
    expect(qs<HTMLInputElement>('[aria-label="Aktueller oder letzter Arbeitgeber"]').value).toBe("Acme GmbH");
  });

  it("never overwrites a field the user (or a previous run) already filled in", async () => {
    qs<HTMLInputElement>('[aria-label="Aktueller oder letzter Arbeitgeber"]').value = "Already typed";
    const { filled } = await fillCustomQuestionAnswers({ "Aktueller oder letzter Arbeitgeber": "AI answer" });
    expect(filled).toBe(0);
    expect(qs<HTMLInputElement>('[aria-label="Aktueller oder letzter Arbeitgeber"]').value).toBe("Already typed");
  });

  it("detects a datalist-backed <input list> question with its option values (spec_5 section A)", async () => {
    const detected = (await detectCustomQuestions()).find((q) => q.question.includes("company fleet"));
    expect(detected?.options).toEqual(["Volvo", "Saab", "Fiat", "Audi"]);

    const { filled } = await fillCustomQuestionAnswers({ [detected!.question]: "Saab" });
    expect(filled).toBe(1);
    expect(qs<HTMLInputElement>('input[name="car_pref"]').value).toBe("Saab");
  });

  it("also finds the real, distinct questions in the 'Custom question cards' section — no <label>, generic placeholder, real question in a sibling <p>", async () => {
    const questions = (await detectCustomQuestions()).map((q) => q.question);
    // Neither field collapses to the shared generic placeholder text, and
    // each gets its own distinct real question rather than colliding.
    expect(questions.some((q) => q === "Type your answer here...")).toBe(false);
    expect(questions.some((q) => q.includes("work from the Munich office"))).toBe(true);
    expect(questions.some((q) => q.includes("production system"))).toBe(true);
  });
});

/**
 * Regression test for: two picker-added fields sharing an identical
 * detected `question` text (very plausible — e.g. two textareas with the
 * same generic "Type your answer here…" placeholder, as in the "Custom
 * question cards" section) must not collapse into the same answer slot.
 * `answerAndFillQuestions` (Side Panel) keys its answers map with this
 * function specifically to avoid that collision — this locks the contract
 * it depends on.
 */
describe("questionAnswerKey", () => {
  it("keys locator-carrying (picker-added) questions by their locator, not by text", () => {
    const a = { question: "Type your answer here...", locator: { tag: "f1", selector: "", textHint: "" } };
    const b = { question: "Type your answer here...", locator: { tag: "f2", selector: "", textHint: "" } };
    expect(questionAnswerKey(a)).not.toBe(questionAnswerKey(b));
  });

  it("keys auto-detected (no locator) questions by their text, so a re-scan still matches", () => {
    const a = { question: "Why do you want to work here?" };
    const b = { question: "Why do you want to work here?" };
    expect(questionAnswerKey(a)).toBe(questionAnswerKey(b));
    expect(questionAnswerKey(a)).toBe("Why do you want to work here?");
  });
});

/**
 * spec_5 section A, second half: a field with no `<select>`/`<datalist>`
 * but whose own DOM shape (`role="combobox"`) signals it hides a choice
 * list until opened. Deliberately not part of the fixture (`loadFixture`
 * parses the page inertly — none of its own scripts run), so this
 * constructs a live listener directly, the way a real React-Select-style
 * widget renders its `[role="option"]` rows into the DOM only once opened.
 */
describe("combobox reveal-on-interaction (spec_5 section A)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("opens a combobox with no native options, reads the options it reveals, and closes it again", async () => {
    document.body.innerHTML = `
      <label for="fav-ide">Which IDE do you use day to day?
        <div id="fav-ide" role="combobox" aria-label="Which IDE do you use day to day?" aria-haspopup="listbox" tabindex="0"></div>
      </label>
    `;
    const combo = document.getElementById("fav-ide")!;
    let opened = false;
    combo.addEventListener("mousedown", () => {
      opened = true;
      const list = document.createElement("ul");
      list.setAttribute("role", "listbox");
      for (const text of ["VS Code", "Vim", "IntelliJ"]) {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = text;
        list.appendChild(li);
      }
      document.body.appendChild(list);
    });
    combo.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") document.querySelector("ul[role=listbox]")?.remove();
    });

    const detected = (await detectCustomQuestions()).find((q) => q.question.includes("IDE"));
    expect(opened).toBe(true);
    expect(detected?.options).toEqual(["VS Code", "Vim", "IntelliJ"]);
    // Closed again — nothing left open on the page.
    expect(document.querySelector("ul[role=listbox]")).toBeNull();
  });

  /**
   * Regression test for a real greenhouse.io behavior reported directly:
   * their react-select-style combobox only opens via its dedicated
   * "Toggle flyout" indicator button — a mousedown/click on the input
   * itself does nothing there. `findFlyoutToggle` must be tried, and
   * clicking the input directly must NOT also fire (it would just
   * re-toggle the menu closed on a widget where a single control handles
   * both).
   */
  it("opens via a nearby menu-toggle button when clicking the input alone would do nothing (greenhouse.io react-select)", async () => {
    document.body.innerHTML = `
      <label for="visa-status">Which visa status applies to you?
        <div class="select__control">
          <input id="visa-status" role="combobox" aria-label="Which visa status applies to you?" aria-haspopup="listbox" tabindex="0" />
          <button type="button" aria-label="Toggle flyout"></button>
        </div>
      </label>
    `;
    const combo = document.getElementById("visa-status")!;
    const toggle = document.querySelector('button[aria-label="Toggle flyout"]')!;
    let comboClicked = false;
    combo.addEventListener("mousedown", () => {
      comboClicked = true;
    });
    toggle.addEventListener("mousedown", () => {
      const list = document.createElement("ul");
      list.setAttribute("role", "listbox");
      for (const text of ["Citizen", "Work permit"]) {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = text;
        list.appendChild(li);
      }
      document.body.appendChild(list);
    });

    const detected = (await detectCustomQuestions()).find((q) => q.question.includes("visa status"));
    expect(comboClicked).toBe(false);
    expect(detected?.options).toEqual(["Citizen", "Work permit"]);
  });

  it("leaves options undefined for an ordinary text field — never probes anything but a combobox-shaped one", async () => {
    document.body.innerHTML = `<label for="plain">Why do you want to work here?<input id="plain" /></label>`;
    const detected = (await detectCustomQuestions()).find((q) => q.question.includes("work here"));
    expect(detected?.options).toBeUndefined();
  });

  /**
   * Regression test for a real bug caught in review: `detectCustomQuestions`
   * used to probe every combobox-shaped field in parallel (`Promise.all`),
   * and each probe scanned the whole `document` for `[role="option"]` —
   * so two widgets open at once could bleed into each other's option list.
   * Fixed by probing one field at a time and preferring each field's own
   * `aria-controls` target. This fixture uses two comboboxes that both
   * render into `document.body` (as a real popover-positioned listbox
   * would) specifically so a document-wide scan while both are open would
   * see both lists — proving isolation actually holds, not just that a
   * scoped lookup exists unused.
   */
  it("keeps two comboboxes' revealed options separate even though both would be visible via a document-wide scan", async () => {
    document.body.innerHTML = `
      <label for="visa">Which visa status applies to you?<div id="visa" role="combobox" aria-label="Which visa status applies to you?" aria-controls="visa-list" aria-haspopup="listbox" tabindex="0"></div></label>
      <ul id="visa-list" role="listbox"></ul>
      <label for="tz">Which time zone do you work in?<div id="tz" role="combobox" aria-label="Which time zone do you work in?" aria-controls="tz-list" aria-haspopup="listbox" tabindex="0"></div></label>
      <ul id="tz-list" role="listbox"></ul>
    `;
    const fillList = (listId: string, texts: string[]) => {
      const list = document.getElementById(listId)!;
      list.innerHTML = "";
      for (const text of texts) {
        const li = document.createElement("li");
        li.setAttribute("role", "option");
        li.textContent = text;
        list.appendChild(li);
      }
    };
    document.getElementById("visa")!.addEventListener("mousedown", () => fillList("visa-list", ["Citizen", "Work permit"]));
    document.getElementById("tz")!.addEventListener("mousedown", () => fillList("tz-list", ["UTC", "CET"]));

    const questions = await detectCustomQuestions();
    expect(questions.find((q) => q.question.includes("visa status"))?.options).toEqual(["Citizen", "Work permit"]);
    expect(questions.find((q) => q.question.includes("time zone"))?.options).toEqual(["UTC", "CET"]);
  });

  it("still closes the widget (Escape) even when reading its options throws mid-probe", async () => {
    document.body.innerHTML = `
      <label for="broken">What is your favorite broken widget?<div id="broken" role="combobox" aria-label="What is your favorite broken widget?" aria-haspopup="listbox" tabindex="0"></div></label>
    `;
    const combo = document.getElementById("broken")!;
    let escapeSeen = false;
    combo.addEventListener("mousedown", () => {
      // Simulate a hostile/broken getter blowing up mid-probe.
      Object.defineProperty(document, "getElementById", {
        configurable: true,
        value: () => {
          throw new Error("boom");
        },
      });
    });
    combo.setAttribute("aria-controls", "does-not-matter");
    combo.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Escape") escapeSeen = true;
    });

    const originalGetElementById = document.getElementById.bind(document);
    try {
      const detected = (await detectCustomQuestions()).find((q) => q.question.includes("broken widget"));
      expect(detected?.options).toBeUndefined();
      expect(escapeSeen).toBe(true);
    } finally {
      Object.defineProperty(document, "getElementById", { configurable: true, value: originalGetElementById });
    }
  });
});

/**
 * Regression test for a real bug caught in review: a `role="combobox"`
 * trigger renders its own placeholder ("Select your level") as visible
 * `textContent` rather than a `placeholder` attribute — `isEmptyField` used
 * to treat that as an already-answered field and never write the AI's
 * answer in. A field that already shows a genuine selected value must still
 * be protected from being overwritten.
 */
describe("filling a combobox trigger (spec_5 section A)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("fills a combobox whose visible text is just its own placeholder", async () => {
    document.body.innerHTML = `
      <label for="level">Select your level<div id="level" role="combobox" aria-label="Select your level" tabindex="0">Select your level</div></label>
    `;
    const { filled } = await fillCustomQuestionAnswers({ "Select your level": "Advanced" });
    expect(filled).toBe(1);
    expect(document.getElementById("level")!.textContent).toBe("Advanced");
  });

  it("never overwrites a combobox that already shows a real selected value", async () => {
    document.body.innerHTML = `
      <label for="level">Select your level<div id="level" role="combobox" aria-label="Select your level" tabindex="0">Advanced</div></label>
    `;
    const { filled } = await fillCustomQuestionAnswers({ "Select your level": "Beginner" });
    expect(filled).toBe(0);
    expect(document.getElementById("level")!.textContent).toBe("Advanced");
  });

  /**
   * Regression test for a real bug reported live: greenhouse.io's
   * react-select-style bracket questions (e.g. its salary-range question,
   * covered separately for the semantic-autofill path in
   * `autofill-page.test.ts` since a "salary" label there is a known profile
   * field, not a generic AI-answered custom question) render a *multi-select*
   * flyout (`aria-multiselectable="true"`, menu stays open after a choice)
   * whose trigger is never typeable at all — the old code path here would
   * type the AI's answer text straight into the trigger's
   * `textContent`/`value`, which does nothing on that widget. Filling it
   * must instead open the flyout via its toggle button and click the
   * `[role="option"]` row whose text matches the answer. This exercises the
   * exact same DOM shape with a neutral, non-profile-matching question so it
   * goes through the AI custom-question pipeline instead.
   */
  it("selects a matching option by clicking it, for a flyout-only multi-select combobox with a toggle button (greenhouse.io react-select)", async () => {
    document.body.innerHTML = `
      <label for="team-size">Which team size would you like to work in?
        <div>
          <input id="team-size" role="combobox" aria-label="Which team size would you like to work in?" aria-haspopup="listbox" aria-controls="team-size-listbox" />
          <button type="button" aria-label="Toggle flyout"></button>
        </div>
      </label>
      <div id="team-size-listbox" role="listbox" aria-multiselectable="true"></div>
    `;
    const toggle = document.querySelector('button[aria-label="Toggle flyout"]')!;
    const listbox = document.getElementById("team-size-listbox")!;
    const sizes = ["1-5 people", "6-15 people", "16-30 people", "31+ people"];
    let mousedownSelected = "";
    toggle.addEventListener("mousedown", () => {
      listbox.innerHTML = sizes.map((text) => `<div role="option">${text}</div>`).join("");
    });
    // A multi-select menu keeps rendering after a click (it doesn't close),
    // and reacts to mousedown rather than click — mirroring react-select.
    listbox.addEventListener("mousedown", (e) => {
      const target = e.target as HTMLElement;
      if (target.getAttribute("role") === "option") mousedownSelected = target.textContent ?? "";
    });

    const { filled } = await fillCustomQuestionAnswers({
      "Which team size would you like to work in?": "6-15 people",
    });
    expect(filled).toBe(1);
    expect(mousedownSelected).toBe("6-15 people");
    // The trigger itself is never typed into for this widget shape.
    expect((document.getElementById("team-size") as HTMLInputElement).value).toBe("");
  });

  it("leaves the field untouched and reports it unfilled when the flyout never opens at all (trusted-event-gated widget)", async () => {
    document.body.innerHTML = `
      <label for="relocate">Are you willing to relocate for this role?
        <div>
          <input id="relocate" role="combobox" aria-label="Are you willing to relocate for this role?" aria-haspopup="listbox" aria-controls="relocate-listbox" />
          <button type="button" aria-label="Toggle flyout"></button>
        </div>
      </label>
      <div id="relocate-listbox" role="listbox"></div>
    `;
    // No mousedown listener on the toggle at all — mirrors a real build
    // (confirmed live on job-boards.greenhouse.io) that only reacts to a
    // genuinely trusted click, which a content script can never dispatch.

    const { filled, unfilled } = await fillCustomQuestionAnswers({
      "Are you willing to relocate for this role?": "Yes",
    });
    expect(filled).toBe(0);
    expect(unfilled).toEqual(["Are you willing to relocate for this role?"]);
    expect((document.getElementById("relocate") as HTMLInputElement).value).toBe("");
  });

  it("falls back to typing into the trigger when the opened flyout has no option matching the answer", async () => {
    document.body.innerHTML = `
      <label for="team-size">Which team size would you like to work in?
        <div>
          <input id="team-size" role="combobox" aria-label="Which team size would you like to work in?" aria-haspopup="listbox" aria-controls="team-size-listbox" />
          <button type="button" aria-label="Toggle flyout"></button>
        </div>
      </label>
      <div id="team-size-listbox" role="listbox"></div>
    `;
    const toggle = document.querySelector('button[aria-label="Toggle flyout"]')!;
    const listbox = document.getElementById("team-size-listbox")!;
    toggle.addEventListener("mousedown", () => {
      listbox.innerHTML = `<div role="option">1-5 people</div>`;
    });

    const { filled } = await fillCustomQuestionAnswers({
      "Which team size would you like to work in?": "not a listed option at all",
    });
    expect(filled).toBe(1);
    expect((document.getElementById("team-size") as HTMLInputElement).value).toBe("not a listed option at all");
  });
});

function qs<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`fixture missing expected element: ${selector}`);
  return el;
}
