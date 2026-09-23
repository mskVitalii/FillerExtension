import type { CustomField, FaqEntry, LanguageLevel, Profile } from "@/types/profile";
import { getCustomFields, getCvMeta, getFaqAnswers, getGenerationRules, getLanguageLevels, getPersonalLegend, getProfile } from "./repository";

export interface ApplicantContext {
  profile: Profile;
  cvText: string;
  personalLegend: string;
  generationRules: string;
  languageLevels: LanguageLevel[];
  customFields: CustomField[];
  faq: FaqEntry[];
}

// The local-storage keys every repository setter above writes through
// (`setLocal(key, ...)`) that feed into `ApplicantContext` — `Object.keys`
// on the storage-change diff, not a per-setter call, is the single choke
// point that invalidates the cache below no matter which repository
// function (saveProfile, uploadCv, setActiveLegend, deleteLegend, …) wrote
// it, instead of that call being duplicated at every one of them.
const CONTEXT_STORAGE_KEYS = new Set([
  "profileCache",
  "cvLibraryCache",
  "legendLibraryCache",
  "customFieldsCache",
  "languageLevelsCache",
  "faqAnswersCache",
  "generationRulesCache",
]);

let cached: Promise<ApplicantContext> | null = null;

function fetchContext(): Promise<ApplicantContext> {
  return Promise.all([
    getProfile(),
    getCvMeta(),
    getPersonalLegend(),
    getGenerationRules(),
    getLanguageLevels(),
    getCustomFields(),
    getFaqAnswers(),
  ]).then(([profile, cvMeta, legend, generationRules, languageLevels, customFields, faq]) => ({
    profile,
    cvText: cvMeta?.text ?? "",
    personalLegend: legend?.content ?? "",
    generationRules: generationRules?.content ?? "",
    languageLevels,
    customFields,
    faq,
  }));
}

/**
 * Profile/CV/Personal Legend/custom fields/language levels/FAQ, fetched
 * once and reused across every AI call in a burst — generating a cover
 * letter, auto-answering N custom questions the moment the panel opens,
 * grounding a job search — instead of each one independently re-running the
 * same 6-7 parallel repository reads and re-serializing the same JSON
 * (spec_8 item 1). This is a soft, in-memory cache for the background
 * service worker's current lifetime only (Chrome can unload it at any
 * time) — not a persistence layer, so a cold start just repays the cost
 * once, same as the cache-then-Drive reads it wraps.
 */
export function getApplicantContext(): Promise<ApplicantContext> {
  if (!cached) {
    cached = fetchContext();
    // Don't pin a failed fetch (e.g. Drive not connected yet, transient
    // storage error) — the next call should retry, not keep replaying the
    // same rejection for the rest of the worker's lifetime.
    cached.catch(() => {
      cached = null;
    });
  }
  return cached;
}

// Guarded: this module is reachable from the Vitest/jsdom regression suite
// via `answer-question.ts` (test/answer-question.test.ts), which doesn't
// stub `chrome` (content-script/DOM-engine tests never touch it) — a
// top-level `chrome.*` reference at import time would crash that suite
// even though nothing in it actually calls `getApplicantContext`.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    if (Object.keys(changes).some((key) => CONTEXT_STORAGE_KEYS.has(key))) cached = null;
  });
}
