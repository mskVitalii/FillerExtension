import type { ProfileFieldKey } from "@/types/profile";
import { fieldKind } from "@/features/fill-stats/dom";
import { collapse, fieldQuestionText, nativeFieldOptions } from "./field-signal";
import { elementSignalParts, isUnclassifiedField } from "./field-detector";
import { isComboboxLike } from "./combobox";

/**
 * The AI half of the profile autofill (`engine.ts`), run as a second pass after the offline one:
 * - an option pick for a dropdown whose options the offline matchers couldn't match to a known
 *   value ("Germany" vs "Bundesrepublik Deutschland", "65 000 €" vs a bracket written out in words);
 * - a profile key for a short-labelled field the detector couldn't classify.
 * Both go out as one Decisions request through the background (`DECIDE_FIELDS`), never from the
 * page. The request/answer shapes live here because the content script builds them; the
 * background side is `features/openai/decide-fields.ts`. Answers are cached for the page's
 * lifetime, so a refill, a re-render or a second Autofill click never asks twice.
 */

/** A dropdown that must be set to `value`, but no option matched it offline. */
export interface OptionPickQuestion {
  id: string;
  field: ProfileFieldKey;
  /** The field's label on the page. */
  label: string;
  /** The applicant's value, as the AI should read it ("Munich, Germany", "65000"). */
  value: string;
  options: string[];
}

/** What the page says about a field the detector couldn't classify. */
export interface FieldSignals {
  label: string;
  /** `input:text`, `select`, `combobox`, … */
  kind: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  autocomplete?: string;
  /** Every other label-ish text the detector looked at (nearby text, the ATS's own title). */
  other?: string[];
  /** A select's / datalist's first options — they often say what the field is. */
  options?: string[];
}

export interface FieldKindQuestion {
  id: string;
  signals: FieldSignals;
}

export interface FieldDecisionRequest {
  optionPicks: OptionPickQuestion[];
  fieldKinds: FieldKindQuestion[];
}

/** Null = no confident answer (below the threshold, "none of these", "not a profile field"). */
export interface FieldDecisionResult {
  optionPicks: { id: string; choice: string | null }[];
  fieldKinds: { id: string; field: ProfileFieldKey | null }[];
}

/** Injected into `autofillDocument`: the content script sends `DECIDE_FIELDS`, tests pass a stub. */
export type FieldDecider = (request: FieldDecisionRequest) => Promise<FieldDecisionResult>;

/** A Decisions round trip should take a second or two; past this the pass is skipped (its answers still get cached). */
const DECIDE_TIMEOUT_MS = 12000;
const MAX_FIELD_QUESTIONS = 60;
const MAX_OPTIONS = 300;

const optionCache = new Map<string, string | null>();
const fieldCache = new Map<string, ProfileFieldKey | null>();

/** Tests only: forget every cached answer. */
export function clearAiDecisionCache(): void {
  optionCache.clear();
  fieldCache.clear();
}

export function optionCacheKey(q: Omit<OptionPickQuestion, "id">): string {
  return [q.field, q.label, q.value, q.options.join("\u0002")].join("\u0001");
}

/** Re-render-proof identity of a field, for the classification cache. */
function fieldSignature(el: HTMLElement): string {
  const attr = (name: string) => el.getAttribute(name)?.trim() ?? "";
  return [fieldKind(el), attr("name"), attr("autocomplete"), attr("aria-label"), attr("placeholder"), fieldQuestionText(el)].join("\u0001");
}

/** The profile key an earlier AI pass gave this field, if it gave one. */
export function cachedAiField(el: HTMLElement): ProfileFieldKey | null {
  return fieldCache.get(fieldSignature(el)) ?? null;
}

const AI_KIND_INPUT_TYPES = new Set(["", "text", "email", "tel", "url", "number"]);

/**
 * A field worth asking the AI about: an empty single-line input, a select or a combobox the
 * detector found nothing for (`isUnclassifiedField`). Text areas and question-shaped labels are
 * application questions — the custom-question path answers those.
 */
export function aiClassifiable(el: HTMLElement): boolean {
  if (el.closest('[role="search"], nav')) return false;
  if (el instanceof HTMLInputElement) {
    if (!AI_KIND_INPUT_TYPES.has(el.type) || el.value.trim()) return false;
  } else if (!(el instanceof HTMLSelectElement) && !isComboboxLike(el)) {
    return false;
  }
  return isUnclassifiedField(el);
}

export function fieldSignals(el: HTMLElement): FieldSignals {
  const attr = (name: string) => el.getAttribute(name)?.trim() || undefined;
  const label = collapse(fieldQuestionText(el));
  const named = new Set([label, attr("name"), attr("id"), attr("placeholder"), attr("aria-label")]);
  const other = [...new Set(elementSignalParts(el).map(collapse))].filter((t) => t && !named.has(t));
  const options = nativeFieldOptions(el)?.slice(0, 12);
  return {
    label,
    kind: fieldKind(el),
    name: attr("name"),
    id: attr("id"),
    placeholder: attr("placeholder"),
    ariaLabel: attr("aria-label"),
    autocomplete: attr("autocomplete"),
    ...(other.length > 0 ? { other } : {}),
    ...(options ? { options } : {}),
  };
}

export interface PendingPick extends Omit<OptionPickQuestion, "id"> {
  key: string;
}

export interface PendingKind {
  key: string;
  signals: FieldSignals;
}

export function pendingPick(q: Omit<OptionPickQuestion, "id">): PendingPick {
  const options = [...new Set(q.options.map(collapse).filter(Boolean))].slice(0, MAX_OPTIONS);
  const clean = { ...q, options };
  return { ...clean, key: optionCacheKey(clean) };
}

export function pendingKind(el: HTMLElement): PendingKind {
  return { key: fieldSignature(el), signals: fieldSignals(el) };
}

/**
 * Answers for every pick and field asked, from the cache where possible and one `decide` call
 * for the rest. A failed or timed-out call answers nothing (and caches nothing), which leaves
 * the fill exactly as the offline pass left it.
 */
export async function decideCached(
  decide: FieldDecider,
  picks: PendingPick[],
  kinds: PendingKind[],
): Promise<{ choice: (key: string) => string | null; field: (key: string) => ProfileFieldKey | null }> {
  const askPicks = [...new Map(picks.filter((p) => !optionCache.has(p.key)).map((p) => [p.key, p])).values()];
  const askKinds = [...new Map(kinds.filter((k) => !fieldCache.has(k.key)).map((k) => [k.key, k])).values()].slice(0, MAX_FIELD_QUESTIONS);
  if (askPicks.length + askKinds.length > 0) {
    const request: FieldDecisionRequest = {
      optionPicks: askPicks.map((p, i) => ({ id: `o${i}`, field: p.field, label: p.label, value: p.value, options: p.options })),
      fieldKinds: askKinds.map((k, i) => ({ id: `f${i}`, signals: k.signals })),
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), DECIDE_TIMEOUT_MS);
    });
    const answered = decide(request).then((result) => {
      // Cached even when it arrives after the timeout: the next run uses it.
      for (const { id, choice } of result.optionPicks) {
        const pick = askPicks[Number(id.slice(1))];
        if (pick && id.startsWith("o")) optionCache.set(pick.key, choice && pick.options.includes(choice) ? choice : null);
      }
      for (const { id, field } of result.fieldKinds) {
        const kind = askKinds[Number(id.slice(1))];
        if (kind && id.startsWith("f")) fieldCache.set(kind.key, field);
      }
      return result;
    });
    try {
      await Promise.race([answered, timeout]);
    } catch (error) {
      // No key, quota, network: the offline fill stands as it is.
      console.warn("[Filler] AI field decisions unavailable", error);
    } finally {
      clearTimeout(timer);
    }
    answered.catch(() => undefined);
  }
  return {
    choice: (key) => optionCache.get(key) ?? null,
    field: (key) => fieldCache.get(key) ?? null,
  };
}
