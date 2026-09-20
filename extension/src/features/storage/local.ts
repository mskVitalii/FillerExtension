import type { CandidateSummary, CustomField, CvLibrary, CvMeta, FaqEntry, LanguageLevel, PersonalLegend, Profile } from "@/types/profile";
import type { UrlActivation } from "@/types/application";
import type { Job } from "@/types/job";
import { mergeBackfilledActivations } from "@/features/applications/stats";
import { todayISO } from "@/lib/date-format";

/**
 * chrome.storage.local — small local-only data: the user's OpenAI API key
 * and offline caches of Drive-backed documents (spec section 20).
 * Never store large documents here; the source of truth for CV/legend/
 * profile is Google Drive appDataFolder.
 */
interface LocalStorageSchema {
  openaiApiKey: string;
  /** spec_5 section C — optional secondary job-search providers, same "local only" trust tier as the OpenAI key. */
  tavilyApiKey: string;
  adzunaAppId: string;
  adzunaAppKey: string;
  profileCache: Profile;
  /** @deprecated superseded by `cvLibraryCache` — read once for migration, never written again. */
  cvMetaCache: CvMeta;
  cvLibraryCache: CvLibrary;
  legendCache: PersonalLegend;
  customFieldsCache: CustomField[];
  languageLevelsCache: LanguageLevel[];
  faqAnswersCache: FaqEntry[];
  candidateSummaryCache: CandidateSummary;
  /** Most recently generated/edited cover letter, so the context menu can insert it. */
  lastCoverLetter: string;
  /** spec_6 — every job URL the extension was activated on, one entry per unique URL, for the submissions chart. */
  activationLog: UrlActivation[];
  /**
   * Once a job posting's position/company/location/description has been
   * determined for a URL (DOM heuristics or the paid AI fallback), keyed by
   * that exact URL so re-opening the panel on it later — a new tab, a
   * restart, a bookmark revisited days later — reuses it instead of paying
   * for `extractJobWithAi` again. `chrome.storage.session`'s per-tab
   * `TabState` already avoids re-detecting within one tab's lifetime; this
   * covers everything that outlives a tab.
   */
  jobExtractionCache: Record<string, Job>;
}

export async function getLocal<K extends keyof LocalStorageSchema>(
  key: K,
): Promise<LocalStorageSchema[K] | undefined> {
  const result = await chrome.storage.local.get(key);
  return result[key];
}

export async function setLocal<K extends keyof LocalStorageSchema>(
  key: K,
  value: LocalStorageSchema[K],
): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function removeLocal<K extends keyof LocalStorageSchema>(key: K): Promise<void> {
  await chrome.storage.local.remove(key);
}

export async function getOpenAiApiKey(): Promise<string | undefined> {
  return getLocal("openaiApiKey");
}

export async function setOpenAiApiKey(key: string): Promise<void> {
  await setLocal("openaiApiKey", key);
}

export async function deleteOpenAiApiKey(): Promise<void> {
  await removeLocal("openaiApiKey");
}

export interface JobSearchCredentials {
  tavilyApiKey: string;
  adzunaAppId: string;
  adzunaAppKey: string;
}

export async function getJobSearchCredentials(): Promise<JobSearchCredentials> {
  const result = await chrome.storage.local.get(["tavilyApiKey", "adzunaAppId", "adzunaAppKey"]);
  return {
    tavilyApiKey: result.tavilyApiKey ?? "",
    adzunaAppId: result.adzunaAppId ?? "",
    adzunaAppKey: result.adzunaAppKey ?? "",
  };
}

export async function setJobSearchCredentials(credentials: JobSearchCredentials): Promise<void> {
  await chrome.storage.local.set(credentials);
}

/**
 * Records that the user actually acted on `url` — ran Autofill or started a
 * cover letter — not merely that the panel was opened there (spec_6); a
 * no-op for a URL already logged, so repeating either action on the same
 * job posting never inflates the count. Query-string/hash variations of the
 * same posting are deliberately NOT normalized here: the caller passes
 * whatever `tab.url` the browser reports, matching how `applicationIdForUrl`
 * treats URLs elsewhere in the extension.
 */
export async function recordUrlActivation(url: string): Promise<void> {
  const log = (await getLocal("activationLog")) ?? [];
  if (log.some((entry) => entry.url === url)) return;
  await setLocal("activationLog", [...log, { url, date: todayISO() }]);
}

export async function getUrlActivations(): Promise<UrlActivation[]> {
  return (await getLocal("activationLog")) ?? [];
}

/** Removes one URL's activation entry — used when the user deletes it from the Applications list. */
export async function removeUrlActivation(url: string): Promise<void> {
  const log = (await getLocal("activationLog")) ?? [];
  await setLocal(
    "activationLog",
    log.filter((entry) => entry.url !== url),
  );
}

/**
 * Persists `mergeBackfilledActivations`' result so a returning user's
 * pre-existing Drive applications only need backfilling into the log once —
 * every load after the first is a plain read. See that function for why
 * backfilling matters at all.
 */
export async function getUrlActivationsWithBackfill(
  applications: { url: string; createdAt: string }[],
): Promise<UrlActivation[]> {
  const log = await getUrlActivations();
  const merged = mergeBackfilledActivations(log, applications);
  if (merged !== log) await setLocal("activationLog", merged);
  return merged;
}

export async function getCachedJob(url: string): Promise<Job | undefined> {
  const cache = await getLocal("jobExtractionCache");
  return cache?.[url];
}

export async function setCachedJob(url: string, job: Job): Promise<void> {
  const cache = (await getLocal("jobExtractionCache")) ?? {};
  await setLocal("jobExtractionCache", { ...cache, [url]: job });
}
