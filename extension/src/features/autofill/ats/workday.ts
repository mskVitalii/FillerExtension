import type { Profile, ProfileFieldKey } from "@/types/profile";
import { countryCandidates } from "@/lib/country-codes";
import { resolvePhone } from "@/lib/phone";
import { collapse } from "../field-signal";
import { typeSearchText } from "../native-setter";
import type { AtsAdapter, AtsStep, AtsStepKind, CvHistory, EducationEntry, QuestionHints, WorkEntry } from "./types";
import {
  clickLikeUser,
  isShown,
  normOption,
  parseDateParts,
  pickBestOption,
  pressKey,
  salutationCandidates,
  sectionHeading,
  sleep,
  typeAndCommit,
  waitFor,
  type YearMonthDay,
} from "./shared";

/**
 * Workday Recruiting (`*.myworkdayjobs.com`, and the same app on employers' own
 * domains). Built from the live DOM of a public German tenant's "Apply Manually" →
 * "My Information" page plus Workday's documented `data-automation-id` scheme
 * (see `test/ats/README.md`).
 *
 * What the generic engine gets wrong here, and this adapter fixes:
 * - Every single-choice dropdown is a `<button aria-haspopup="listbox">` showing
 *   "Select One", with a hidden `<input>` beside it; the options only exist once it
 *   is clicked. The engine's selector doesn't include buttons, and that hidden input
 *   would otherwise catch the neighbour's text as its label.
 * - Salutations are tenant-localized ("Frau"/"Herr"), countries too.
 * - The phone number has its own "Country Phone Code" search prompt; the number
 *   itself is national.
 * - Dates are three spin-button inputs (month / day / year).
 * - "My Experience" is a repeater: one "Add" per job / degree.
 * - There is no `<form>` element anywhere, so consent checkboxes need a root.
 */

const AID = "data-automation-id";

function aid(el: Element | null | undefined): string {
  return el?.getAttribute(AID) ?? "";
}

/** `formField-legalName--firstName` → `legalName--firstName`. */
function formFieldKey(el: HTMLElement): string {
  const field = el.closest<HTMLElement>(`[${AID}^="formField-"]`);
  return field ? aid(field).slice("formField-".length) : "";
}

const PROFILE_BY_KEY: Record<string, ProfileFieldKey | null> = {
  "legalName--firstName": "firstName",
  "legalName--lastName": "lastName",
  "legalName--salutation": "salutation",
  "legalName--middleName": null,
  "legalName--hereditary": null,
  "legalName--title": null,
  "legalName--social": null,
  "legalName--secondaryLastName": null,
  preferredCheck: null,
  addressLine1: "address",
  addressLine2: null,
  addressLine3: null,
  city: "city",
  postalCode: "postalCode",
  countryRegion: null,
  regionSubdivision1: null,
  country: "country",
  emailAddress: "email",
  phoneNumber: "phone",
  countryPhoneCode: null,
  phoneType: null,
  extension: null,
  linkedInAccount: "linkedin",
  linkedinQuestion: "linkedin",
  source: null,
  candidateIsPreviousWorker: null,
};

/** Optional name parts and companions handled elsewhere: never a profile field, never an AI question. */
const IGNORED_KEYS = new Set([
  "legalName--hereditary",
  "legalName--middleName",
  "legalName--social",
  "legalName--title",
  "legalName--secondaryLastName",
  "preferredCheck",
  "addressLine2",
  "addressLine3",
  "extension",
  "phoneType",
  "countryPhoneCode",
]);

const REPEAT_ID_RE = /^(workExperience|education|language|webAddress|certification|skills?)-\d+--/;
const REPEAT_GROUP_SELECTOR = `[${AID}^="workExperience-"], [${AID}^="education-"], [${AID}^="language-"], [${AID}^="webAddress-"], [${AID}^="certification-"]`;

/** A field of a "My Experience" repeater entry — filled by `fillWorkdayExperience`, never by the profile or question passes. */
function isRepeatField(el: HTMLElement): boolean {
  return REPEAT_ID_RE.test(el.id) || el.closest(REPEAT_GROUP_SELECTOR) !== null;
}

export function isListboxButton(el: Element): el is HTMLButtonElement {
  return el instanceof HTMLButtonElement && el.getAttribute("aria-haspopup") === "listbox";
}

/** A multiselect search prompt (Country Phone Code, Skills, School, "How did you hear" on some tenants). */
function isPromptInput(el: Element): el is HTMLInputElement {
  return (
    el instanceof HTMLInputElement &&
    el.closest(`[${AID}="multiSelectContainer"], [data-uxi-widget-type="multiselect"]`) !== null
  );
}

const DATE_SECTIONS = ["dateSectionMonth-input", "dateSectionDay-input", "dateSectionYear-input"] as const;

function dateWrapper(el: HTMLElement): HTMLElement | null {
  if (!DATE_SECTIONS.includes(aid(el) as (typeof DATE_SECTIONS)[number])) return null;
  return el.closest<HTMLElement>(`[${AID}="dateInputWrapper"]`) ?? el.parentElement;
}

function dateSection(wrapper: ParentNode, which: (typeof DATE_SECTIONS)[number]): HTMLInputElement | null {
  return wrapper.querySelector<HTMLInputElement>(`input[${AID}="${which}"]`);
}

/** The one section of a date widget that stands for the whole date in the question scan (the first one shown). */
function isDateRepresentative(el: HTMLElement): boolean {
  const wrapper = dateWrapper(el);
  if (!wrapper) return false;
  const first = wrapper.querySelector(DATE_SECTIONS.map((s) => `input[${AID}="${s}"]`).join(", "));
  return first === el;
}

function selectedPills(container: ParentNode): string[] {
  return Array.from(container.querySelectorAll(`[${AID}="selectedItem"]`)).map((n) => collapse(n.textContent ?? ""));
}

// ---------------------------------------------------------------------------
// Listbox dropdowns
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE = /^(select one|bitte (aus)?w(ä|ae)hlen|ausw(ä|ae)hlen|choose one|--)$/i;

function listOptions(list: ParentNode): HTMLElement[] {
  return Array.from(list.querySelectorAll<HTMLElement>("[role='option']")).filter(
    (o) => o.getAttribute("data-value") !== "" && o.getAttribute("aria-disabled") !== "true" && !PLACEHOLDER_RE.test(collapse(o.textContent ?? "")),
  );
}

function openList(btn: HTMLElement): HTMLElement | null {
  const id = btn.getAttribute("aria-controls");
  const list = id ? btn.ownerDocument.getElementById(id) : null;
  return list && listOptions(list).length > 0 ? list : null;
}

function closeList(btn: HTMLElement): void {
  btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
}

async function readListbox(btn: HTMLElement): Promise<{ list: HTMLElement; options: HTMLElement[] } | null> {
  let list = openList(btn);
  if (!list) {
    btn.focus?.();
    clickLikeUser(btn);
    list = await waitFor(() => openList(btn), 1500);
  }
  return list ? { list, options: listOptions(list) } : null;
}

/** What a listbox button shows as chosen, "" while it still reads "Select One". */
export function listboxShownValue(btn: HTMLElement): string {
  const text = collapse(btn.textContent ?? "");
  return PLACEHOLDER_RE.test(text) ? "" : text;
}

/** Opens a Workday dropdown, clicks the option best matching `candidates`, and checks the button now shows it. */
export async function pickFromListbox(btn: HTMLElement, candidates: string[]): Promise<boolean> {
  const shown = listboxShownValue(btn);
  if (shown && pickBestOption([shown], candidates)) return true;

  const opened = await readListbox(btn);
  if (!opened) return false;
  const texts = opened.options.map((o) => collapse(o.textContent ?? ""));
  const chosen = pickBestOption(texts, candidates);
  if (!chosen) {
    closeList(btn);
    return false;
  }
  clickLikeUser(opened.options[texts.indexOf(chosen)]);
  const took = await waitFor(() => normOption(listboxShownValue(btn)) === normOption(chosen), 1000);
  if (!took) closeList(btn);
  return Boolean(took);
}

// ---------------------------------------------------------------------------
// Multiselect search prompts
// ---------------------------------------------------------------------------

function promptResults(doc: Document): HTMLElement[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(`[${AID}="promptOption"], [${AID}="menuItem"] [role='option']`))
    .filter((o) => !o.closest(`[${AID}="selectedItemList"]`) && isShown(o))
    .map((o) => o.closest<HTMLElement>("[role='option']") ?? o);
}

/**
 * Types a search into a Workday prompt, presses Enter, and clicks the result best
 * matching `candidates`. A prompt already holding a matching pill is left alone.
 */
export async function fillPrompt(input: HTMLInputElement, candidates: string[], search = candidates[0]): Promise<boolean> {
  const container = input.closest(`[${AID}="multiSelectContainer"], [data-uxi-widget-type="multiselect"]`) ?? input.parentElement!;
  if (pickBestOption(selectedPills(container), candidates)) return true;
  if (!search) return false;

  typeSearchText(input, search);
  pressKey(input, "Enter");
  const results = await waitFor(() => {
    const found = promptResults(input.ownerDocument);
    return found.length > 0 ? found : null;
  }, 2000);
  if (!results) return false;
  const texts = results.map((r) => collapse(r.textContent ?? ""));
  const chosen = pickBestOption(texts, candidates);
  if (!chosen) {
    pressKey(input, "Escape");
    return false;
  }
  clickLikeUser(results[texts.indexOf(chosen)]);
  return Boolean(await waitFor(() => pickBestOption(selectedPills(container), [chosen]), 1000));
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Writes a date into a Workday month/day/year widget; sections the widget lacks are skipped. */
export function fillDateWidget(wrapper: ParentNode, parts: YearMonthDay): boolean {
  const month = dateSection(wrapper, "dateSectionMonth-input");
  const day = dateSection(wrapper, "dateSectionDay-input");
  const year = dateSection(wrapper, "dateSectionYear-input");
  if (!month && !day && !year) return false;
  if ((month && parts.month == null) || (day && parts.day == null)) return false;
  let ok = true;
  if (month) ok = typeAndCommit(month, String(parts.month).padStart(2, "0")) && ok;
  if (day) ok = typeAndCommit(day, String(parts.day).padStart(2, "0")) && ok;
  if (year) ok = typeAndCommit(year, String(parts.year)) && ok;
  return ok;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

const HOST_RE = /(^|\.)(myworkdayjobs\.com|myworkday\.com|workdayjobs\.com)$/i;
const DOM_MARKERS = [
  `[${AID}="applyFlowPage"]`,
  `[${AID}^="applyFlow"]`,
  `[${AID}="jobPostingHeader"]`,
  `[${AID}="signInContent"]`,
  `[${AID}="createAccountSubmitButton"]`,
  `[${AID}="signInSubmitButton"]`,
  `[${AID}="adventureButton"]`,
  `[${AID}="applyManually"]`,
  `[${AID}="autofillWithResume"]`,
].join(", ");

function countryValueCandidates(value: string): string[] {
  return countryCandidates(value);
}

function candidatesFor(field: ProfileFieldKey, value: string): string[] {
  if (field === "country") return countryValueCandidates(value);
  if (field === "salutation") return salutationCandidates(value);
  return [value];
}

const MOBILE_CANDIDATES = ["Mobile", "Mobil", "Mobiltelefon", "Mobile Phone", "Cell", "Handy"];

/** English name of a country for an ISO code, for the phone-code prompt's search. */
function regionName(iso2: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(iso2.toUpperCase()) ?? "";
  } catch {
    return "";
  }
}

async function fillPhoneCode(doc: Document, profile: Profile): Promise<boolean> {
  const field = doc.querySelector(`[${AID}="formField-countryPhoneCode"]`);
  const input = field?.querySelector<HTMLInputElement>("input");
  if (!field || !input) return false;
  const phone = resolvePhone(profile.phone, profile.country);
  const name = phone?.iso2 ? regionName(phone.iso2) : profile.country;
  if (!name) return false;
  const code = phone ? `+${phone.callingCode}` : "";
  const pills = selectedPills(field);
  if (pills.some((p) => p.toLowerCase().includes(name.toLowerCase()) && (!code || p.includes(code)))) return false;
  const candidates = code ? [`${name} (${code})`, name] : [name];
  return fillPrompt(input, candidates, name);
}

const STEP_NAMES: Record<string, string> = {
  applyFlowMyInfoPage: "My Information",
  applyFlowMyExpPage: "My Experience",
  applyFlowPrimaryQuestionsPage: "Application Questions",
  applyFlowSecondaryQuestionsPage: "Application Questions",
  applyFlowApplicationQuestionsPage: "Application Questions",
  applyFlowVoluntaryDisclosuresPage: "Voluntary Disclosures",
  applyFlowSelfIdentificationPage: "Self Identify",
  applyFlowReviewPage: "Review",
};

const SUBMITTED_RE =
  /application (was |has been )?submitted|thank you for (your )?appl|bewerbung (wurde )?(erfolgreich )?(übermittelt|eingereicht|abgeschickt|versendet)|vielen dank für ihre bewerbung/i;

function visibleByAid(doc: Document, id: string): HTMLElement | null {
  return Array.from(doc.querySelectorAll<HTMLElement>(`[${AID}="${id}"]`)).find(isShown) ?? null;
}

function workdayErrors(doc: Document): string[] {
  return Array.from(doc.querySelectorAll<HTMLElement>(`[${AID}="errorMessage"], [${AID}="errorBanner"], [${AID}="inputAlert"]`))
    .filter(isShown)
    .map((n) => collapse(n.textContent ?? ""))
    .filter(Boolean);
}

function workdayStep(doc: Document): AtsStep {
  const base = { ats: "workday", name: "", index: null, total: null, next: null, nextIsSubmit: false, back: null, errors: workdayErrors(doc) };
  const make = (kind: AtsStepKind, extra: Partial<AtsStep>): AtsStep => ({ ...base, kind, ...extra });

  if (SUBMITTED_RE.test(collapse(doc.body?.textContent ?? "").slice(0, 5000)) && !doc.querySelector(`[${AID}^="applyFlow"][${AID}$="Page"]`)) {
    return make("submitted", { name: "Submitted" });
  }

  const page = Array.from(doc.querySelectorAll<HTMLElement>(`[${AID}^="applyFlow"][${AID}$="Page"]`)).find(
    (p) => aid(p) !== "applyFlowPage" && isShown(p),
  );
  if (page) {
    const active = doc.querySelector(`[${AID}="progressBarActiveStep"]`);
    const m = collapse(active?.textContent ?? "").match(/(\d+)\s*(?:of|von|\/)\s*(\d+)/i);
    const next = visibleByAid(doc, "pageFooterNextButton") ?? visibleByAid(doc, "bottom-navigation-next-button");
    const isReview = aid(page) === "applyFlowReviewPage" || /^(submit|absenden|bewerbung absenden)$/i.test(collapse(next?.textContent ?? ""));
    const heading = collapse(page.querySelector("h2, h3")?.textContent ?? "");
    return make(isReview ? "review" : "form", {
      name: STEP_NAMES[aid(page)] ?? heading,
      index: m ? Number(m[1]) : null,
      total: m ? Number(m[2]) : null,
      next,
      nextIsSubmit: isReview,
      back: visibleByAid(doc, "pageFooterBackButton") ?? visibleByAid(doc, "bottom-navigation-previous-button"),
    });
  }

  const createAccount = visibleByAid(doc, "createAccountSubmitButton");
  if (createAccount || visibleByAid(doc, "verifyPassword")) {
    return make("register", { name: "Create Account", next: createAccount });
  }
  const signIn = visibleByAid(doc, "signInSubmitButton");
  if (signIn) return make("login", { name: "Sign In", next: signIn });

  const manual = visibleByAid(doc, "applyManually");
  if (manual || visibleByAid(doc, "autofillWithResume")) return make("start", { name: "Start Your Application", next: manual });

  const apply = visibleByAid(doc, "adventureButton");
  if (apply) return make("posting", { name: "Job Posting", next: apply });

  return make("unknown", {});
}

function fileSlotText(input: HTMLInputElement): string {
  const field = input.closest<HTMLElement>(`[${AID}^="formField-"]`);
  const label = field?.querySelector("label")?.textContent ?? "";
  return collapse(`${sectionHeading(input)} ${label} ${aid(field)} ${input.getAttribute("aria-label") ?? ""}`);
}

const CV_SLOT_RE = /resume|\bcv\b|lebenslauf|curriculum/i;
const COVER_SLOT_RE = /cover|anschreiben|motivation/i;

export const workday: AtsAdapter = {
  id: "workday",

  detect(url, doc) {
    return HOST_RE.test(url.hostname) || doc.querySelector(DOM_MARKERS) !== null;
  },

  extraFillables(doc) {
    return Array.from(doc.querySelectorAll<HTMLElement>(`button[aria-haspopup="listbox"]`)).filter(
      (b) => b.closest(`[${AID}^="formField-"]`) !== null,
    );
  },

  isIgnored(el) {
    // The value-carrier input Workday renders next to each dropdown button.
    if (el instanceof HTMLInputElement && el.previousElementSibling && isListboxButton(el.previousElementSibling)) return true;
    // An SMS marketing opt-in with no label of its own: never ticked.
    if (aid(el) === "phone-sms-opt-in") return true;
    if (isRepeatField(el)) return true;
    const key = formFieldKey(el);
    if (IGNORED_KEYS.has(key) || key.startsWith("preferredName")) return true;
    if (dateWrapper(el) && !isDateRepresentative(el)) return true;
    return false;
  },

  mapField(el) {
    if (isRepeatField(el)) return null;
    const key = formFieldKey(el);
    if (!key) return undefined;
    if (key in PROFILE_BY_KEY) return PROFILE_BY_KEY[key];
    if (key.startsWith("preferredName") || key.startsWith("legalName--")) return null;
    // A questionnaire's fields are the employer's own questions, never profile fields — the
    // generic detector would read "…Arbeitserlaubnis für Deutschland?" as a country field.
    if (el.closest(`[${AID}$="QuestionsPage"], [${AID}="applyFlowVoluntaryDisclosuresPage"]`)) return null;
    return undefined;
  },

  fillField(el, field, value, profile) {
    if (isListboxButton(el)) return pickFromListbox(el, candidatesFor(field, value));
    if (isPromptInput(el)) return fillPrompt(el, candidatesFor(field, value));
    if (field === "phone" && formFieldKey(el) === "phoneNumber" && el instanceof HTMLInputElement) {
      // The country code is its own prompt (filled in `afterFill`): the number is national.
      const phone = resolvePhone(value, profile.country);
      return Promise.resolve(typeAndCommit(el, phone ? phone.significant : value));
    }
    return undefined;
  },

  async afterFill(profile, doc) {
    let filled = 0;
    const phoneType = doc.querySelector<HTMLElement>(`[${AID}="formField-phoneType"] button[aria-haspopup="listbox"]`);
    if (phoneType && profile.phone && !listboxShownValue(phoneType) && (await pickFromListbox(phoneType, MOBILE_CANDIDATES))) filled++;
    if (profile.phone && (await fillPhoneCode(doc, profile))) filled++;
    return filled;
  },

  questionText(el) {
    const wrapper = dateWrapper(el);
    if (!wrapper) return undefined;
    const by = wrapper.getAttribute("aria-labelledby");
    const label = (by ? el.ownerDocument.getElementById(by) : null) ?? el.closest(`[${AID}^="formField-"]`)?.querySelector("label");
    const text = collapse(label?.textContent ?? "").replace(/\*$/, "").trim();
    return text || undefined;
  },

  async questionHints(el): Promise<QuestionHints | undefined> {
    if (isListboxButton(el)) {
      const opened = await readListbox(el);
      if (!opened) return undefined;
      const options = opened.options.map((o) => collapse(o.textContent ?? "")).filter(Boolean);
      closeList(el);
      return options.length > 0 ? { options: options.slice(0, 40) } : undefined;
    }
    const wrapper = dateWrapper(el);
    if (wrapper) {
      if (dateSection(wrapper, "dateSectionDay-input")) return { dateKind: "date" };
      if (dateSection(wrapper, "dateSectionMonth-input")) return { dateKind: "month" };
    }
    return undefined;
  },

  fillAnswer(el, answer) {
    if (isListboxButton(el)) return pickFromListbox(el, [answer]);
    if (isPromptInput(el)) return fillPrompt(el, [answer]);
    const wrapper = dateWrapper(el);
    if (wrapper) {
      const parts = parseDateParts(answer);
      return Promise.resolve(parts ? fillDateWidget(wrapper, parts) : false);
    }
    return undefined;
  },

  formRoot(el) {
    return el.closest<HTMLElement>(`[${AID}="applyFlowPage"], [${AID}^="applyFlow"], [${AID}="signInContent"], [role="dialog"]`);
  },

  fileInputs(doc, kind) {
    const inputs = Array.from(doc.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((i) => !i.disabled);
    if (inputs.length === 0) return undefined;
    const slots = inputs.map((input) => ({ input, text: fileSlotText(input) }));
    const own = slots.filter((s) => (kind === "cv" ? CV_SLOT_RE : COVER_SLOT_RE).test(s.text) && !(kind === "cv" ? COVER_SLOT_RE : CV_SLOT_RE).test(s.text));
    if (own.length > 0) return own.map((s) => s.input);
    if (kind === "cv") return inputs.length === 1 && !COVER_SLOT_RE.test(slots[0].text) ? inputs : [];
    // No cover-letter slot: Workday's "Resume/CV" uploader takes several files, so the letter goes there too —
    // but only into one that accepts more than one file, never replacing the CV.
    return slots.filter((s) => CV_SLOT_RE.test(s.text) && s.input.multiple).map((s) => s.input);
  },

  step: workdayStep,
};

// ---------------------------------------------------------------------------
// My Experience
// ---------------------------------------------------------------------------

function sectionByHeading(doc: Document, re: RegExp): HTMLElement | null {
  const groups = Array.from(doc.querySelectorAll<HTMLElement>("[role='group'][aria-labelledby]"));
  return groups.find((g) => re.test(doc.getElementById(g.getAttribute("aria-labelledby")!)?.textContent ?? "")) ?? null;
}

function entryPanels(section: HTMLElement, prefix: string): HTMLElement[] {
  return Array.from(section.querySelectorAll<HTMLElement>(`[${AID}^="${prefix}-"]`)).filter((p) => /^\w+-\d+$/.test(aid(p)));
}

function entryField(panel: HTMLElement, key: string): HTMLElement | null {
  return panel.querySelector<HTMLElement>(`[${AID}="formField-${key}"]`);
}

async function addEntry(section: HTMLElement, prefix: string): Promise<HTMLElement | null> {
  const before = entryPanels(section, prefix).length;
  const add = Array.from(section.querySelectorAll<HTMLElement>(`[${AID}="Add"], [${AID}="add-button"], button`)).find((b) =>
    /^(add|add another|hinzufügen|weitere hinzufügen)$/i.test(collapse(b.textContent ?? "")),
  );
  if (!add) return null;
  clickLikeUser(add);
  return waitFor(() => entryPanels(section, prefix)[before] ?? null, 2000);
}

function fillText(panel: HTMLElement, key: string, value: string | undefined): boolean {
  if (!value) return false;
  const input = entryField(panel, key)?.querySelector<HTMLInputElement | HTMLTextAreaElement>("input:not([type='checkbox']), textarea");
  if (!input || input.value.trim()) return false;
  return typeAndCommit(input, value);
}

function fillDate(panel: HTMLElement, key: string, value: string | null | undefined): boolean {
  const field = entryField(panel, key);
  const parts = value ? parseDateParts(value) : null;
  if (!field || !parts) return false;
  const month = dateSection(field, "dateSectionMonth-input");
  if (month && parts.month == null) return false;
  return fillDateWidget(field, parts);
}

async function fillWorkEntry(panel: HTMLElement, entry: WorkEntry): Promise<number> {
  let filled = 0;
  if (fillText(panel, "jobTitle", entry.title)) filled++;
  if (fillText(panel, "companyName", entry.company)) filled++;
  if (fillText(panel, "location", entry.location)) filled++;
  const current = !entry.to;
  const box = entryField(panel, "currentlyWorkHere")?.querySelector<HTMLInputElement>("input[type='checkbox']");
  if (box && box.checked !== current) {
    box.click();
    await sleep(30);
  }
  if (fillDate(panel, "startDate", entry.from)) filled++;
  if (!current && fillDate(panel, "endDate", entry.to)) filled++;
  if (fillText(panel, "roleDescription", entry.description)) filled++;
  return filled;
}

async function fillEducationEntry(panel: HTMLElement, entry: EducationEntry): Promise<number> {
  let filled = 0;
  const school = entryField(panel, "schoolName") ?? entryField(panel, "school");
  const schoolInput = school?.querySelector<HTMLInputElement>("input");
  if (schoolInput && isPromptInput(schoolInput)) {
    if (await fillPrompt(schoolInput, [entry.school])) filled++;
  } else if (fillText(panel, "schoolName", entry.school) || fillText(panel, "school", entry.school)) filled++;

  const degree = entryField(panel, "degree")?.querySelector<HTMLElement>("button[aria-haspopup='listbox']");
  if (degree && entry.degree && (await pickFromListbox(degree, degreeCandidates(entry.degree)))) filled++;

  const study = entryField(panel, "fieldOfStudy")?.querySelector<HTMLInputElement>("input");
  if (study && entry.fieldOfStudy) {
    if (isPromptInput(study) ? await fillPrompt(study, [entry.fieldOfStudy]) : typeAndCommit(study, entry.fieldOfStudy)) filled++;
  }
  if (fillText(panel, "gradeAverage", entry.grade)) filled++;
  if (fillDate(panel, "firstYearAttended", entry.from)) filled++;
  if (fillDate(panel, "lastYearAttended", entry.to)) filled++;
  return filled;
}

/** "M.Sc. Computer Science" → also try "Master", "Master of Science"… so a tenant's degree list can match. */
function degreeCandidates(degree: string): string[] {
  const out = [degree];
  if (/\bm\.?\s?sc\b|master/i.test(degree)) out.push("Master of Science", "Master's Degree", "Master", "Master (or equivalent)");
  if (/\bm\.?\s?a\b/i.test(degree)) out.push("Master of Arts", "Master's Degree", "Master");
  if (/\bb\.?\s?sc\b|bachelor/i.test(degree)) out.push("Bachelor of Science", "Bachelor's Degree", "Bachelor", "Bachelor (or equivalent)");
  if (/\bb\.?\s?a\b/i.test(degree)) out.push("Bachelor of Arts", "Bachelor's Degree", "Bachelor");
  if (/ph\.?\s?d|doctor|promotion/i.test(degree)) out.push("Doctorate", "PhD", "Doctoral Degree", "Doctorate (or equivalent)");
  if (/diplom/i.test(degree)) out.push("Diplom", "Diploma", "Master's Degree");
  if (/abitur|high school/i.test(degree)) out.push("Abitur", "High School Diploma", "High School");
  return [...new Set(out)];
}

/**
 * Fills Workday's "My Experience" repeaters from structured CV history: one entry per
 * job / degree (pressing the section's "Add" for each missing one), then the Websites
 * section. Entries that already hold a value are left as they are, so a user's edits
 * and Workday's own resume parse (from "Autofill with Resume") are never overwritten.
 * Returns how many fields it filled.
 */
export async function fillWorkdayExperience(history: CvHistory, doc: Document = document): Promise<number> {
  let filled = 0;
  const work = sectionByHeading(doc, /work experience|berufserfahrung/i);
  if (work) {
    for (let i = 0; i < history.work.length; i++) {
      const panel = entryPanels(work, "workExperience")[i] ?? (await addEntry(work, "workExperience"));
      if (!panel) break;
      filled += await fillWorkEntry(panel, history.work[i]);
    }
  }
  const education = sectionByHeading(doc, /education|ausbildung|bildung/i);
  if (education) {
    for (let i = 0; i < history.education.length; i++) {
      const panel = entryPanels(education, "education")[i] ?? (await addEntry(education, "education"));
      if (!panel) break;
      filled += await fillEducationEntry(panel, history.education[i]);
    }
  }
  const websites = sectionByHeading(doc, /websites?|webseiten/i);
  if (websites && history.websites?.length) {
    for (let i = 0; i < history.websites.length; i++) {
      const panel = entryPanels(websites, "webAddress")[i] ?? (await addEntry(websites, "webAddress"));
      if (!panel) break;
      if (fillText(panel, "url", history.websites[i])) filled++;
    }
  }
  return filled;
}
