import type { Profile, ProfileFieldKey } from "@/types/profile";
import { detectSemanticField } from "./field-detector";
import { fillElement } from "./native-setter";
import { fillComboboxAnswer, fillComboboxByPicking, isComboboxLike, isReactSelectLike, pickComboboxOption } from "./combobox";
import { fillPhoneField, findDialCodeField, fillSalaryField, resolvePhoneFill } from "./field-format";
import { findConfirmPasswordFields, isNewPasswordField, isRevealedPasswordField } from "./password-fields";
import { countryCandidates } from "@/lib/country-codes";
import { looksLikeSalutationOptions, salutationCandidates, salutationMatches } from "@/lib/salutation";
import { generatePassword } from "@/lib/generate-password";
import { isGhostField, queryFillableDeep } from "./dom-query";
import { describeField, findByKey, type FieldKey } from "./element-locator";
import { guardFills, readValue, type GuardedFill } from "./refill-guard";
import { collapse, fieldQuestionText, nativeFieldOptions } from "./field-signal";
import { takeSeenOptions } from "./option-capture";
import {
  aiClassifiable,
  cachedAiField,
  decideCached,
  pendingKind,
  pendingPick,
  type FieldDecider,
  type PendingKind,
  type PendingPick,
} from "./ai-assist";
import { fieldKind } from "@/features/fill-stats/dom";
import { fillLocationField } from "./location";
import { activeAtsAdapter, isAtsIgnored, withAtsCache } from "./ats";
import type { AtsAdapter } from "./ats/types";
import type { FillFieldStat } from "@/features/fill-stats/stats";
import { backingSelect, repaintFacade } from "./select-facade";
import { radioOptionLabel } from "./pick-questions";
import { setChecked } from "./checkboxes";

const FILLABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], [role="combobox"]';

const EXCLUDED_INPUT_TYPES = new Set(["hidden", "submit", "button", "reset", "checkbox", "radio", "file", "image"]);

function isFillable(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement && EXCLUDED_INPUT_TYPES.has(el.type)) return false;
  if ((el as HTMLInputElement | HTMLTextAreaElement).disabled) return false;
  if (isGhostField(el)) return false;
  if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") return false;
  return true;
}

export { queryFillableDeep };

/**
 * Every fillable element on the page, including the ones an ATS adapter knows are
 * fields although the generic selector misses them (Workday's listbox buttons).
 */
function fillableElements(ats: AtsAdapter | null): HTMLElement[] {
  const found = queryFillableDeep(FILLABLE_SELECTOR);
  const extra = ats?.extraFillables?.(document) ?? [];
  const seen = new Set(found);
  for (const el of extra) if (!seen.has(el)) found.push(el);
  return found.filter(isFillable);
}

/** The ATS adapter's own writer for its widgets, falling back to the generic one. */
function fillWithAdapter(el: HTMLElement, field: ProfileFieldKey, value: string, profile: Profile, ats: AtsAdapter | null): Promise<boolean> {
  return ats?.fillField?.(el, field, value, profile) ?? fillSemanticField(el, field, value, profile);
}

function profileValue(profile: Profile, field: ProfileFieldKey): string {
  return profile[field] ?? "";
}

/**
 * Fills one detected element, rendering the profile value into the shape the
 * field actually wants (spec sections 12-13): a phone number as `+49…` /
 * `0170…` / bare national + a sibling dial-code field; a salary as a bare
 * rounded integer when the field only accepts a number, or the matching
 * bracket option when it only offers discrete ranges to choose from; a
 * country under whichever spelling ("Germany"/"Deutschland"/"DE") the page's
 * `<select>` uses. Everything else is typed verbatim.
 */
async function fillSemanticField(el: HTMLElement, field: ProfileFieldKey, value: string, profile: Profile): Promise<boolean> {
  if (field === "phone") {
    const fill = resolvePhoneFill(el, value, profile.country);
    if (!fill) return fillElement(el, value);
    return fillPhoneField(el, fill);
  }

  if (field === "expectedSalary") {
    return fillSalaryField(el, value);
  }

  // A location typeahead takes only a geocoder result, chosen by city *and* country (location.ts);
  // an ATS with its own non-ARIA dropdown (Lever) fills it its own way (`AtsAdapter.fillField`).
  if (field === "city") return fillLocationField(el, value, profile.country);

  if (field === "country" && el instanceof HTMLSelectElement) {
    for (const candidate of countryCandidates(value)) {
      if (fillElement(el, candidate)) return true;
    }
    return false;
  }

  // "Ms" on a German form is "Frau", on Personio's gender select "Female": try every spelling
  // of the same salutation against the options. Typed verbatim only into a free-text field.
  if (field === "salutation") {
    const candidates = salutationCandidates(value);
    if (el instanceof HTMLSelectElement) return candidates.some((candidate) => fillElement(el, candidate));
    if (isComboboxLike(el) && isReactSelectLike(el)) {
      return fillComboboxByPicking(el, (texts) => texts.find((t) => salutationMatches(t, value)) ?? null);
    }
  }

  // A react-select dropdown (Greenhouse's "My pronouns are", "Country", …) takes a value only by
  // clicking one of its options; typing would leave the search text there and nothing chosen.
  if (isComboboxLike(el) && isReactSelectLike(el)) {
    const candidates = field === "country" ? countryCandidates(value) : [value];
    for (const candidate of candidates) {
      if (await fillComboboxAnswer(el, candidate)) return true;
    }
    return false;
  }

  return fillElement(el, value);
}

/**
 * Registration forms need a *fresh* password, not a profile value, so this
 * is deliberately separate from the semantic-field pass above. It fills a
 * password box only when it reads as a *create-a-password* field — either
 * `autocomplete="new-password"` or the cluster of create-flow signals
 * `isNewPasswordField` looks for (policy/strength handler, strength-meter
 * `aria-describedby`, "choose/confirm your password" label, a sibling
 * confirmation field) — never an ordinary login field.
 */
function fillRegistrationPassword(elements: HTMLElement[]): { password: string | null; filled: number } {
  const newPasswordInputs = elements.filter(isNewPasswordField);
  if (newPasswordInputs.length === 0) return { password: null, filled: 0 };

  const targets = new Set<HTMLInputElement>(newPasswordInputs);
  for (const input of newPasswordInputs) {
    for (const confirmField of findConfirmPasswordFields(input)) targets.add(confirmField);
  }

  const password = generatePassword();
  let filled = 0;
  for (const el of targets) {
    if (fillElement(el, password)) filled++;
  }
  return { password: filled > 0 ? password : null, filled };
}

/**
 * Scans the page, detects each fillable field's semantic type, and fills it
 * from the profile (spec sections 12-13). Returns how many fields it could
 * confidently fill so the Side Panel can report progress, plus a freshly
 * generated password when the page looks like a registration form.
 *
 * Async, and fields are filled one at a time (not `Promise.all`): a
 * flyout-driven salary combobox (`fillSalaryField`) opens and closes its own
 * widget, and two open at once can steal each other's focus (see
 * `combobox.ts`).
 */
async function autofillDocumentUncached(
  profile: Profile,
  options: {
    /**
     * Called once the refill guard settles, with what happened to every field
     * recognized as a profile field (fill statistics, `features/fill-stats`).
     */
    onReport?: (fields: FillFieldStat[]) => void;
    /**
     * The AI second pass (`ai-assist.ts`): dropdowns no option matched offline, and fields the
     * detector couldn't classify. Absent (FillerAgent, tests) → the offline fill only.
     */
    decideFields?: FieldDecider;
  } = {},
): Promise<{ filled: number; total: number; generatedPassword: string | null }> {
  const ats = activeAtsAdapter();
  const elements = fillableElements(ats);

  // A phone widget's own dial-code companion (e.g. greenhouse.io's
  // react-select "Country" flag/calling-code picker) is very often labelled
  // literally "Country" and would otherwise match the *address*-country
  // pattern too — `detectSemanticField` has no way to tell those two "country"
  // meanings apart on its own. `findDialCodeField` is the one place that
  // already knows which field belongs to a phone number, so anything it
  // claims is reserved here and skipped by the generic pass below — it's
  // filled (or correctly left alone) exclusively by the phone branch,
  // never mistaken for the applicant's own home-address country.
  const dialCodeFields = new Set<HTMLElement>();
  for (const el of elements) {
    if (detectSemanticField(el) === "phone") {
      const companion = findDialCodeField(el);
      if (companion) dialCodeFields.add(companion);
    }
  }

  // A select2 / selectmenu / chosen facade and its native <select> are one field: it is filled
  // through the select (which submits the value) and found by either one's label.
  const facadeSelect = new Map<HTMLElement, HTMLSelectElement>();
  for (const el of elements) {
    const select = backingSelect(el);
    if (select) facadeSelect.set(el, select);
  }
  const selectsWithFacade = new Set(facadeSelect.values());

  let filled = 0;
  const decide = options.decideFields;
  const guarded: GuardedFill[] = [];
  const stats: FillFieldStat[] = [];
  /** `guarded[i]` is `guardedStats[i]`'s field. */
  const guardedStats: FillFieldStat[] = [];
  const misses: OptionMiss[] = [];
  const unclassified: Unclassified[] = [];
  for (const el of elements) {
    // Defense in depth on top of the label-matching patterns themselves:
    // no profile value is ever a password, so a password-type input is
    // never a legitimate target for this pass regardless of what its label
    // happens to match — only fillRegistrationPassword() below is allowed
    // to write into one.
    if (el instanceof HTMLInputElement && el.type === "password") continue;
    // …nor one whose "Show password" toggle turned it into a text box for now.
    if (isRevealedPasswordField(el)) continue;
    if (dialCodeFields.has(el)) continue;
    if (selectsWithFacade.has(el as HTMLSelectElement)) continue;
    const facade = facadeSelect.has(el) ? el : null;
    const target: HTMLElement = facadeSelect.get(el) ?? el;
    // The ATS adapter's own mapping (and what it ignores) is part of `detectSemanticField`.
    const detected = facade ? (detectSemanticField(target) ?? detectSemanticField(facade)) : detectSemanticField(el);
    // A field an earlier AI pass on this page classified fills offline now, like a detected one.
    const field = detected ?? (decide ? cachedAiField(target) : null);
    if (!field) {
      if (decide && aiClassifiable(target)) {
        unclassified.push({ ref: fieldRef(target), facade: facade && fieldRef(facade), before: readValue(target), pending: pendingKind(target) });
      }
      continue;
    }
    // A salary <select> that only picks the currency or the period ("EUR", "pro Jahr" — concludis
    // puts both right after the amount, under the same label) is not the amount.
    if (field === "expectedSalary" && target instanceof HTMLSelectElement && !hasNumericOption(target)) continue;
    const value = profileValue(profile, field);
    const stat: FillFieldStat = { kind: fieldKind(el), field, label: fieldQuestionText(el).slice(0, 120), filler: "no-value" };
    stats.push(stat);
    if (!value) continue;
    const outcome = await fillProfileField(target, facade, field, value, profile, ats, stat, Boolean(decide));
    if (outcome.guard) {
      filled++;
      guarded.push(outcome.guard);
      guardedStats.push(stat);
    }
    if (outcome.miss) misses.push(outcome.miss);
  }
  // Not awaited: the guard keeps the values in place through the form's next re-render
  // (refill-guard.ts) while the rest of the fill, and the AI pass, go on.
  const offlineGuard = guardFills(guarded);

  // Fields with an obvious answer but no profile key (Workday's "Phone Device Type", its phone-code prompt).
  if (ats?.afterFill) {
    try {
      filled += await ats.afterFill(profile, document);
    } catch (error) {
      console.warn(`[Filler] ${ats.id} afterFill failed`, error);
    }
  }

  filled += fillSalutationRadios(profile.salutation, stats);

  const { password: generatedPassword, filled: passwordFilled } = fillRegistrationPassword(elements);
  filled += passwordFilled;

  // The AI pass runs last, so it never holds up an offline fill; its own fills get their own guard.
  let aiGuard = guardFills([]);
  let aiGuardedStats: FillFieldStat[] = [];
  if (decide && (misses.length > 0 || unclassified.length > 0)) {
    try {
      const ai = await runAiPass(profile, ats, decide, misses, unclassified, stats);
      filled += ai.filled;
      aiGuard = guardFills(ai.guarded);
      aiGuardedStats = ai.guardedStats;
    } catch (error) {
      console.warn("[Filler] AI autofill pass failed", error);
    }
  }
  void Promise.all([offlineGuard, aiGuard]).then(([offline, ai]) => {
    for (const i of offline.lostIndexes) guardedStats[i].filler = "lost";
    for (const i of ai.lostIndexes) aiGuardedStats[i].filler = "lost";
    options.onReport?.(stats);
  });

  return { filled, total: elements.length, generatedPassword };
}

/** A field found once, re-found by key if a re-render replaced it while the AI was answering. */
interface FieldRef {
  el: HTMLElement;
  key: FieldKey;
}

function fieldRef(el: HTMLElement): FieldRef {
  return { el, key: describeField(el) };
}

function liveElement(ref: FieldRef): HTMLElement | null {
  if (ref.el.isConnected) return ref.el;
  const found = findByKey(ref.key);
  if (found) ref.el = found;
  return found;
}

/** A dropdown with a known value that no option matched offline — for the AI pass. */
interface OptionMiss {
  ref: FieldRef;
  facade: FieldRef | null;
  field: ProfileFieldKey;
  /** What the field held before the fill; it is only picked while it still does. */
  before: string;
  stat: FillFieldStat;
  pick: PendingPick;
  /** The search term a typeahead showed those options for. */
  query: string;
}

/** A field the detector couldn't classify — for the AI pass. */
interface Unclassified {
  ref: FieldRef;
  facade: FieldRef | null;
  before: string;
  pending: PendingKind;
}

/**
 * Fills one profile field and returns its refill-guard entry, or — when it failed on a dropdown
 * whose options didn't match and `collectMiss` is set — the miss for the AI pass.
 */
async function fillProfileField(
  target: HTMLElement,
  facade: HTMLElement | null,
  field: ProfileFieldKey,
  value: string,
  profile: Profile,
  ats: AtsAdapter | null,
  stat: FillFieldStat,
  collectMiss: boolean,
): Promise<{ guard: GuardedFill | null; miss: OptionMiss | null }> {
  const before = readValue(target);
  const key = describeField(target);
  stat.filler = "failed";
  takeSeenOptions();
  if (await fillWithAdapter(target, field, value, profile, ats)) {
    if (facade) repaintFacade(facade, target as HTMLSelectElement);
    stat.filler = "filled";
    const guard: GuardedFill = {
      el: target,
      before,
      locate: () => findByKey(key),
      refill: (fresh) => fillWithAdapter(fresh, field, value, profile, ats),
    };
    return { guard, miss: null };
  }
  if (!collectMiss) return { guard: null, miss: null };
  const options = target instanceof HTMLSelectElement ? (nativeFieldOptions(target) ?? []) : takeSeenOptions();
  if (options.length === 0) return { guard: null, miss: null };
  // A city is only unambiguous with its country ("Munich" → "München / Bayern", not Munich, ND).
  const shown = field === "city" && profile.country ? `${value}, ${profile.country}` : value;
  const miss: OptionMiss = {
    ref: { el: target, key },
    facade: facade && fieldRef(facade),
    field,
    before,
    stat,
    query: field === "city" ? profile.city : value,
    pick: pendingPick({ field, label: fieldQuestionText(facade ?? target), value: shown, options }),
  };
  return { guard: null, miss };
}

/** Sets a dropdown to the option text the AI chose — by exact text, never by retyping the value. */
function applyOptionChoice(
  el: HTMLElement,
  field: ProfileFieldKey,
  choice: string,
  query: string,
  profile: Profile,
  ats: AtsAdapter | null,
): Promise<boolean> {
  if (el instanceof HTMLSelectElement) {
    const option = Array.from(el.options).find((o) => collapse(o.textContent ?? "") === choice);
    return Promise.resolve(Boolean(option) && fillElement(el, option!.value || choice));
  }
  // An ATS widget (Workday, SuccessFactors) is picked by its own writer: the choice is one of its option texts.
  return ats?.fillField?.(el, field, choice, profile) ?? pickComboboxOption(el, choice, query);
}

interface AiPassResult {
  filled: number;
  guarded: GuardedFill[];
  guardedStats: FillFieldStat[];
}

/**
 * The second, AI pass (`ai-assist.ts`): one Decisions request for every option miss and every
 * unclassified field, then the picks and the newly classified fields are filled. A field filled
 * that way can miss its options in turn (a select of countries spelled differently) — those get
 * one follow-up request. Every field is re-found by key and left alone if its value changed
 * meanwhile (the user got there first).
 */
async function runAiPass(
  profile: Profile,
  ats: AtsAdapter | null,
  decide: FieldDecider,
  misses: OptionMiss[],
  unclassified: Unclassified[],
  stats: FillFieldStat[],
): Promise<AiPassResult> {
  const out: AiPassResult = { filled: 0, guarded: [], guardedStats: [] };

  const applyPick = async (miss: OptionMiss, choice: string | null) => {
    if (!choice) return;
    const el = liveElement(miss.ref);
    if (!el || readValue(el) !== miss.before) return;
    const apply = (target: HTMLElement) => applyOptionChoice(target, miss.field, choice, miss.query, profile, ats);
    if (!(await apply(el))) return;
    const facade = miss.facade && liveElement(miss.facade);
    if (facade && el instanceof HTMLSelectElement) repaintFacade(facade, el);
    miss.stat.filler = "filled";
    out.filled++;
    out.guarded.push({ el, before: miss.before, locate: () => findByKey(miss.ref.key), refill: apply });
    out.guardedStats.push(miss.stat);
  };

  const answers = await decideCached(decide, misses.map((m) => m.pick), unclassified.map((u) => u.pending));
  for (const miss of misses) await applyPick(miss, answers.choice(miss.pick.key));

  const followUp: OptionMiss[] = [];
  for (const field of unclassified) {
    const key = answers.field(field.pending.key);
    if (!key) continue;
    const el = liveElement(field.ref);
    if (!el || readValue(el) !== field.before) continue;
    if (key === "expectedSalary" && el instanceof HTMLSelectElement && !hasNumericOption(el)) continue;
    const facade = field.facade && liveElement(field.facade);
    const value = profileValue(profile, key);
    const stat: FillFieldStat = { kind: fieldKind(facade ?? el), field: key, label: fieldQuestionText(facade ?? el).slice(0, 120), filler: "no-value" };
    stats.push(stat);
    if (!value) continue;
    const outcome = await fillProfileField(el, facade, key, value, profile, ats, stat, true);
    if (outcome.guard) {
      out.filled++;
      out.guarded.push(outcome.guard);
      out.guardedStats.push(stat);
    }
    if (outcome.miss) followUp.push(outcome.miss);
  }

  if (followUp.length > 0) {
    const more = await decideCached(decide, followUp.map((m) => m.pick), []);
    for (const miss of followUp) await applyPick(miss, more.choice(miss.pick.key));
  }
  return out;
}

function hasNumericOption(select: HTMLSelectElement): boolean {
  return Array.from(select.options).some((opt) => /\d/.test(opt.textContent ?? ""));
}

/**
 * Salutation asked as radios ("Frau / Herr / Divers" — Umantis, many custom portals): the
 * semantic pass above skips radios, so a group whose options are all salutation words, or whose
 * label reads as one, gets the option matching the profile's salutation. A group the page
 * already answered is left alone.
 */
function fillSalutationRadios(salutation: string, stats: FillFieldStat[]): number {
  if (!salutation) return 0;
  const groups = new Map<string, HTMLInputElement[]>();
  for (const el of queryFillableDeep('input[type="radio"]')) {
    if (!(el instanceof HTMLInputElement) || el.disabled || !el.name) continue;
    // A voluntary EEO / demographic survey's gender question stays unanswered (ats/).
    if (isAtsIgnored(el)) continue;
    groups.set(el.name, [...(groups.get(el.name) ?? []), el]);
  }
  let filled = 0;
  for (const radios of groups.values()) {
    if (radios.some((r) => r.checked)) continue;
    const labels = radios.map(radioOptionLabel);
    const isSalutation = looksLikeSalutationOptions(labels) || detectSemanticField(radios[0]) === "salutation";
    if (!isSalutation) continue;
    const match = radios.find((r, i) => salutationMatches(labels[i], salutation) || salutationMatches(r.value, salutation));
    const stat: FillFieldStat = { kind: "radio", field: "salutation", label: labels.join(" / ").slice(0, 120), filler: "failed" };
    stats.push(stat);
    if (match && setChecked(match, true)) {
      stat.filler = "filled";
      filled++;
    }
  }
  return filled;
}

/** `autofillDocumentUncached` with ATS detection memoised for the whole run (`withAtsCache`). */
export function autofillDocument(...args: Parameters<typeof autofillDocumentUncached>): ReturnType<typeof autofillDocumentUncached> {
  return withAtsCache(() => autofillDocumentUncached(...args));
}
