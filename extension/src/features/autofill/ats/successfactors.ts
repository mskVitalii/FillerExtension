import type { ProfileFieldKey } from "@/types/profile";
import { countryCandidates } from "@/lib/country-codes";
import { collapse } from "../field-signal";
import { fillElement } from "../native-setter";
import type { AtsAdapter, AtsStep, AtsStepKind, QuestionHints } from "./types";
import {
  clickLikeUser,
  datePatternOf,
  formatDatePattern,
  isShown,
  normOption,
  parseDateParts,
  pickBestOption,
  salutationCandidates,
  typeAndCommit,
  waitFor,
} from "./shared";

/**
 * SAP SuccessFactors Recruiting (`career*.successfactors.eu|com`, `*.sapsf.eu|com`,
 * reached from an employer's careers site through `/career?company=…`).
 *
 * Two generations share one host:
 * - the classic JSP pages — the login and "Create an Account" forms (`#careerform`,
 *   `fbclc_*` ids, captured live from a public tenant) and the one-page application
 *   form whose "Apply" button submits;
 * - the SAPUI5 apply flow — `sap.m.Input` / `ComboBox` / `Select` / `DatePicker` /
 *   `CheckBox` / `FileUploader` controls in a `sap.m.Wizard`.
 *
 * Fixes over the generic engine:
 * - Password fields: "Choose Password" with its "Show" toggle becomes `type="text"`;
 *   it's never a profile field and never an AI question (a real SF form once got the
 *   applicant's city in "Kennwort", see `semantic-fields.ts`).
 * - `sap.m.Select` is a `div[role=combobox]` and `sap.m.ComboBox`'s list lives in a
 *   popover — both are chosen by clicking an option, never typed into.
 * - Salutations are "Mr."/"Ms." or "Herr"/"Frau"; countries localized.
 * - Dates are text inputs in the locale's pattern (`dd.MM.yyyy`, `MMM d, y`).
 * - UI5 renders a hidden `<input type="checkbox">` inside each `sap.m.CheckBox` and a
 *   text box beside each file input; both are noise for the scans.
 * - Attachment slots ("Resume", "Cover Letter") are labelled through the row, not the input.
 */

const HOST_RE = /(^|\.)(successfactors\.(eu|com)|sapsf\.(eu|com|cn)|sapsf\.[a-z]+)$/i;
/** Hidden inputs every SF career page carries (`career_company` names the tenant). Not `fbclc_*` alone: other pages copy those ids. */
const DOM_MARKERS = "form#careerform, input#career_company";

const PASSWORD_SIGNAL_RE = /passw|kennwort|\bpwd|pwd(conf)?\b|_pwd|fbclc_pwd/i;

function labelFor(el: HTMLElement): string {
  const id = el.id;
  if (id) {
    const label = el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) return collapse(label.textContent ?? "");
  }
  const by = el.getAttribute("aria-labelledby");
  if (by) {
    return collapse(by.split(/\s+/).map((ref) => el.ownerDocument.getElementById(ref)?.textContent ?? "").join(" "));
  }
  return collapse(el.closest("label")?.textContent ?? "");
}

/** A password box, even while its "Show" toggle has turned it into `type="text"`. */
export function isSfPasswordField(el: HTMLElement): boolean {
  if (!(el instanceof HTMLInputElement)) return false;
  if (el.type === "password") return true;
  return PASSWORD_SIGNAL_RE.test(`${el.name} ${el.id} ${labelFor(el)}`);
}

const PROFILE_BY_ID: Record<string, ProfileFieldKey | null> = {
  fbclc_userName: "email",
  fbclc_emailConf: "email",
  fbclc_fName: "firstName",
  fbclc_mName: null,
  fbclc_lName: "lastName",
  fbclc_country: "country",
  fbclc_phoneNum: "phone",
  username: "email",
};

// ---------------------------------------------------------------------------
// UI5 controls
// ---------------------------------------------------------------------------

/** `sap.m.Select`: a `div[role=combobox].sapMSlt` showing the chosen text. */
function isUi5Select(el: HTMLElement): boolean {
  return el.classList.contains("sapMSlt") && el.getAttribute("role") === "combobox";
}

/** The inner `<input>` of a `sap.m.ComboBox` (`<id>-inner` inside `.sapMComboBox`). */
function isUi5ComboBox(el: HTMLElement): el is HTMLInputElement {
  return el instanceof HTMLInputElement && el.closest(".sapMComboBox, .sapMComboBoxBase") !== null;
}

function controlId(el: HTMLElement): string {
  return el.id.replace(/-inner$/, "");
}

function ui5Options(el: HTMLElement): HTMLElement[] {
  const doc = el.ownerDocument;
  const base = controlId(el);
  const owned = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
  const roots = [owned ? doc.getElementById(owned) : null, doc.getElementById(`${base}-list`), doc.getElementById(`${base}-popup`)].filter(
    (n): n is HTMLElement => n !== null,
  );
  for (const root of roots) {
    const options = Array.from(root.querySelectorAll<HTMLElement>("[role='option']")).filter(isShown);
    if (options.length > 0) return options;
  }
  return [];
}

function ui5Shown(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) return el.value.trim();
  const label = el.querySelector(".sapMSltLabel, .sapMSelectListItemText, [id$='-label']");
  return collapse((label ?? el).textContent ?? "");
}

const UI5_PLACEHOLDER_RE = /^(|select|select one|please select|bitte (aus)?w(ä|ae)hlen|ausw(ä|ae)hlen|-+)$/i;

async function openUi5(el: HTMLElement): Promise<HTMLElement[]> {
  let options = ui5Options(el);
  if (options.length > 0) return options;
  const trigger = isUi5ComboBox(el) ? (el.ownerDocument.getElementById(`${controlId(el)}-arrow`) ?? el) : el;
  clickLikeUser(trigger);
  options = (await waitFor(() => {
    const found = ui5Options(el);
    return found.length > 0 ? found : null;
  }, 1500)) ?? [];
  return options;
}

function closeUi5(el: HTMLElement): void {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
}

/** Opens a UI5 Select / ComboBox, clicks the best option for `candidates`, and checks it took. */
export async function pickUi5Option(el: HTMLElement, candidates: string[]): Promise<boolean> {
  const shown = ui5Shown(el);
  if (shown && !UI5_PLACEHOLDER_RE.test(shown) && pickBestOption([shown], candidates)) return true;
  const options = await openUi5(el);
  const texts = options.map((o) => collapse(o.textContent ?? ""));
  const chosen = pickBestOption(texts, candidates);
  if (!chosen) {
    closeUi5(el);
    // A ComboBox also takes typed text that equals one of its items; nothing else is safe to type.
    return false;
  }
  clickLikeUser(options[texts.indexOf(chosen)]);
  const took = await waitFor(() => normOption(ui5Shown(el)) === normOption(chosen), 1000);
  if (!took) closeUi5(el);
  return Boolean(took);
}

function candidatesFor(field: ProfileFieldKey, value: string): string[] {
  if (field === "country") return countryCandidates(value);
  if (field === "salutation") return salutationCandidates(value);
  return [value];
}

/** A date field: a `sap.m.DatePicker`, or a classic text input whose placeholder is a date pattern. */
function datePattern(el: HTMLElement): string | null {
  if (!(el instanceof HTMLInputElement) || el.type !== "text") return null;
  const pattern = datePatternOf(el.getAttribute("placeholder"));
  if (pattern) return pattern;
  return el.closest(".sapMDP, .sapMDatePicker") ? "dd.MM.yyyy" : null;
}

function fillDate(el: HTMLInputElement, pattern: string, answer: string): boolean {
  const parts = parseDateParts(answer);
  if (!parts || parts.month == null) return false;
  return typeAndCommit(el, formatDatePattern(parts, pattern));
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

const SUBMIT_TEXT_RE = /^(apply|submit|submit application|bewerben|jetzt bewerben|absenden|bewerbung absenden|senden)$/i;
const NEXT_TEXT_RE = /^(next|next step|continue|weiter|fortfahren|review|überprüfen|prüfen)$/i;
const BACK_TEXT_RE = /^(back|previous|zurück)$/i;
const SUBMITTED_RE =
  /thank you for (your )?appl|application (has been |was )?(successfully )?submitted|vielen dank für ihre bewerbung|bewerbung (wurde )?(erfolgreich )?(übermittelt|eingereicht|abgeschickt)/i;
const PRIVACY_RE = /data privacy|privacy statement|datenschutz/i;

function buttons(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>("button, input[type='submit'], input[type='button'], [role='button']")).filter(isShown);
}

function buttonText(b: HTMLElement): string {
  return collapse(b instanceof HTMLInputElement ? b.value : (b.textContent ?? b.getAttribute("aria-label") ?? ""));
}

function findButton(doc: Document, re: RegExp, root: ParentNode = doc): HTMLElement | null {
  return buttons(doc).find((b) => root.contains(b) && re.test(buttonText(b))) ?? null;
}

function sfErrors(doc: Document): string[] {
  return Array.from(doc.querySelectorAll<HTMLElement>("[id$='_error'], .sfError, .sapMMsgStripError, .sapMInputBaseMessage, [role='alert']"))
    .filter(isShown)
    .map((n) => collapse(n.textContent ?? ""))
    .filter(Boolean);
}

function sfStep(doc: Document): AtsStep {
  const base = { ats: "successfactors", name: "", index: null, total: null, next: null, nextIsSubmit: false, back: null, errors: sfErrors(doc) };
  const make = (kind: AtsStepKind, extra: Partial<AtsStep>): AtsStep => ({ ...base, kind, ...extra });

  const dialog = Array.from(doc.querySelectorAll<HTMLElement>("[role='dialog'], .sfDialogBox")).find(
    (d) => isShown(d) && PRIVACY_RE.test(d.textContent ?? ""),
  );
  if (dialog) {
    return make("consent", { name: "Data Privacy Statement", next: findButton(doc, /^(accept|i accept|akzeptieren|zustimmen|ok)$/i, dialog) });
  }

  const register = doc.getElementById("fbclc_createAccountButton");
  if (register && isShown(register)) return make("register", { name: "Create an Account", next: register });

  const password = doc.querySelector<HTMLInputElement>("input#password, input[name='password'], input[name='j_password']");
  const username = doc.querySelector<HTMLInputElement>("input#username, input[name='username'], input[name='j_username']");
  if (password && username && isShown(password)) {
    return make("login", { name: "Sign In", next: findButton(doc, /^(sign in|log ?in|anmelden|einloggen)$/i) });
  }

  const wizard = doc.querySelector<HTMLElement>(".sapMWizard");
  if (wizard && isShown(wizard)) {
    const steps = Array.from(wizard.querySelectorAll<HTMLElement>(".sapMWizardProgressNavStep"));
    const current = steps.findIndex((s) => /^(true|step)$/.test(s.getAttribute("aria-current") ?? ""));
    const submit = findButton(doc, SUBMIT_TEXT_RE);
    const next = findButton(doc, NEXT_TEXT_RE);
    const last = current >= 0 && current === steps.length - 1;
    const stepEl = current >= 0 ? steps[current] : null;
    const name = collapse(stepEl?.getAttribute("title") ?? stepEl?.querySelector(".sapMWizardProgressNavStepTitle")?.textContent ?? "");
    const isReview = Boolean(submit) && (last || !next);
    return make(isReview ? "review" : "form", {
      name,
      index: current >= 0 ? current + 1 : null,
      total: steps.length || null,
      next: isReview ? submit : next,
      nextIsSubmit: isReview,
      back: findButton(doc, BACK_TEXT_RE),
    });
  }

  if (SUBMITTED_RE.test(collapse(doc.body?.textContent ?? "").slice(0, 5000))) return make("submitted", { name: "Submitted" });

  const form = doc.querySelector<HTMLElement>("#careerform") ?? doc.body;
  const visibleInputs = Array.from(form.querySelectorAll<HTMLElement>("input[type='text'], input[type='email'], input[type='tel'], textarea, select")).filter(
    isShown,
  );
  const submit = findButton(doc, SUBMIT_TEXT_RE);
  if (visibleInputs.length >= 3 && submit) return make("review", { name: "Application", next: submit, nextIsSubmit: true });
  if (submit) return make("posting", { name: "Job Posting", next: submit });
  return make("unknown", {});
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

function attachmentSlotText(input: HTMLInputElement): string {
  const doc = input.ownerDocument;
  const parts = [input.getAttribute("aria-label") ?? "", input.title, input.name, input.id];
  const uploader = input.closest<HTMLElement>(".sapUiFup");
  const shownBox = uploader?.querySelector<HTMLInputElement>("input:not([type='file'])");
  if (shownBox) parts.push(labelFor(shownBox));
  if (input.id) parts.push(doc.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent ?? "");
  const row = input.closest<HTMLElement>("tr, .rcmFormField, .sapUiFormElement, .sapUiRFLRow, fieldset");
  if (row) parts.push(row.querySelector("label, .rcmFieldLabel, legend")?.textContent ?? "");
  return collapse(parts.join(" "));
}

const CV_SLOT_RE = /resume|r[ée]sum[ée]|\bcv\b|lebenslauf|curriculum/i;
const COVER_SLOT_RE = /cover|anschreiben|motivation/i;

export const successfactors: AtsAdapter = {
  id: "successfactors",

  detect(url, doc) {
    return HOST_RE.test(url.hostname) || doc.querySelector(DOM_MARKERS) !== null;
  },

  isIgnored(el) {
    // UI5 CheckBox: the real control is the `div[role=checkbox]`; its inner input is a hidden mirror.
    if (el instanceof HTMLInputElement && el.type === "checkbox" && el.closest(".sapMCb") && el.getAttribute("role") !== "checkbox") return true;
    // UI5 FileUploader's read-only text box showing the chosen file name.
    if (el instanceof HTMLInputElement && el.type !== "file" && el.closest(".sapUiFup")) return true;
    // Passwords are never a profile field or an AI question (the registration filler handles real ones).
    if (isSfPasswordField(el)) return true;
    return false;
  },

  mapField(el) {
    if (isSfPasswordField(el)) return null;
    if (el.id in PROFILE_BY_ID) return PROFILE_BY_ID[el.id];
    return undefined;
  },

  fillField(el, field, value) {
    if (isUi5Select(el) || isUi5ComboBox(el)) return pickUi5Option(el, candidatesFor(field, value));
    if (field === "salutation" && el instanceof HTMLSelectElement) {
      const texts = Array.from(el.options).map((o) => collapse(o.textContent ?? ""));
      const chosen = pickBestOption(texts, salutationCandidates(value));
      return Promise.resolve(chosen ? fillElement(el, chosen) : false);
    }
    return undefined;
  },

  async questionHints(el): Promise<QuestionHints | undefined> {
    if (isUi5Select(el) || isUi5ComboBox(el)) {
      const options = (await openUi5(el)).map((o) => collapse(o.textContent ?? "")).filter((t) => t && !UI5_PLACEHOLDER_RE.test(t));
      closeUi5(el);
      return options.length > 0 ? { options: options.slice(0, 40) } : undefined;
    }
    if (datePattern(el)) return { dateKind: "date" };
    return undefined;
  },

  fillAnswer(el, answer) {
    if (isUi5Select(el) || isUi5ComboBox(el)) return pickUi5Option(el, [answer]);
    const pattern = datePattern(el);
    if (pattern && el instanceof HTMLInputElement) return Promise.resolve(fillDate(el, pattern, answer));
    return undefined;
  },

  formRoot(el) {
    // The widest container first: a single `.sapUiForm` block may hold nothing but checkboxes.
    return el.closest<HTMLElement>(".sapMWizard") ?? el.closest<HTMLElement>(".sapMPage, [role='form'], .sapUiForm");
  },

  fileInputs(doc, kind) {
    const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>("input[type='file']")).filter((i) => !i.disabled);
    if (inputs.length === 0) return undefined;
    const own = kind === "cv" ? CV_SLOT_RE : COVER_SLOT_RE;
    const other = kind === "cv" ? COVER_SLOT_RE : CV_SLOT_RE;
    const slots = inputs.map((input) => ({ input, text: attachmentSlotText(input) }));
    const matched = slots.filter((s) => own.test(s.text) && !other.test(s.text));
    if (matched.length > 0) return matched.map((s) => s.input);
    // One unlabelled uploader is still the CV's; anything else goes to the generic label match.
    if (kind === "cv" && inputs.length === 1 && !other.test(slots[0].text)) return inputs;
    return undefined;
  },

  step: sfStep,
};
