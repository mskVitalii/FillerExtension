import type { CustomField, FaqEntry, LanguageLevel, Profile } from "@/types/profile";
import { baseStorageKey } from "@/features/projects/registry";
import { ACTIVE_PROJECT_KEY, currentProjectId } from "@/features/projects/scope";
import { getCustomFields, getCvMeta, getFaqAnswers, getGenerationRules, getLanguageLevels, getOutreachRules, getPersonalLegend, getProfile } from "./repository";

export interface ApplicantContext {
  profile: Profile;
  cvText: string;
  personalLegend: string;
  generationRules: string;
  outreachRules: string;
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
  "outreachRulesCache",
]);

/** Per project: runs of two projects can overlap (a pinned background run, the agent's jobs). */
const cached = new Map<string, Promise<ApplicantContext>>();

function fetchContext(): Promise<ApplicantContext> {
  return Promise.all([
    getProfile(),
    getCvMeta(),
    getPersonalLegend(),
    getGenerationRules(),
    getOutreachRules(),
    getLanguageLevels(),
    getCustomFields(),
    getFaqAnswers(),
  ]).then(([profile, cvMeta, legend, generationRules, outreachRules, languageLevels, customFields, faq]) => ({
    profile,
    cvText: cvMeta?.text ?? "",
    personalLegend: legend?.content ?? "",
    generationRules: generationRules?.content ?? "",
    outreachRules: outreachRules?.content ?? "",
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
export async function getApplicantContext(): Promise<ApplicantContext> {
  const projectId = await currentProjectId();
  let context = cached.get(projectId);
  if (!context) {
    context = fetchContext();
    cached.set(projectId, context);
    // Don't pin a failed fetch (e.g. Drive not connected yet, transient
    // storage error) — the next call should retry, not keep replaying the
    // same rejection for the rest of the worker's lifetime.
    const failed = context;
    failed.catch(() => {
      if (cached.get(projectId) === failed) cached.delete(projectId);
    });
  }
  return context;
}

// Guarded: this module is reachable from the Vitest/jsdom regression suite
// via `answer-question.ts` (test/answer-question.test.ts), which doesn't
// stub `chrome` (content-script/DOM-engine tests never touch it) — a
// top-level `chrome.*` reference at import time would crash that suite
// even though nothing in it actually calls `getApplicantContext`.
if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    // A project's own copy (`p:<id>:profileCache`) or a project switch changes the context too.
    if (Object.keys(changes).some((key) => key === ACTIVE_PROJECT_KEY || CONTEXT_STORAGE_KEYS.has(baseStorageKey(key)))) cached.clear();
  });
}
