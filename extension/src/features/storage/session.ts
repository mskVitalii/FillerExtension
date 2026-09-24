import type { Job, JobLanguageInfo } from "@/types/job";
import type { CustomQuestion } from "@/features/autofill/custom-questions";
import type { CheckboxDecision } from "@/features/openai/decide-checkboxes";
import type { JobSearchProvider, JobSearchResult, JobSearchTiming } from "@/types/job-search";

/**
 * chrome.storage.session — per-tab UI state (current job + cover-letter
 * draft), keyed by tabId. The side panel is one shared document across
 * whichever tab is active, so without this, switching between two job tabs
 * would leak tab A's draft into tab B. Session storage (not local) is the
 * right tier: it's scoped to the browser session and clears on restart,
 * matching the "throwaway UI cache" nature of this data — the source of
 * truth for anything durable is Drive, not this.
 */
export interface TabState {
  url: string;
  job: Job;
  coverLetter: string;
  /** An unsent paste shouldn't vanish on tab switch either (spec_2 item 2). */
  pasteMode: boolean;
  pasteText: string;
  /** Keyed by language name — one entry per language in "My Languages" plus
   * any language the user picked manually, translated in parallel so
   * switching tabs never re-triggers a request for one already generated. */
  translations: Record<string, string>;
  activeTranslationLanguage: string;
  customQuestions: CustomQuestion[];
  /** Keyed by question text — avoids re-generating an answer already fetched for this job. */
  customQuestionAnswers: Record<string, string>;
  /** AI verdict per consent/marketing checkbox — cached so a tab switch doesn't re-run the pass. */
  checkboxDecisions?: CheckboxDecision[];
  jobLanguage: JobLanguageInfo | null;
  /** Generated on demand for this tab's registration form — kept per-tab, not in the durable
   * profile, since a password must never be reused across sites. */
  generatedPassword: string | null;
  /** The position as extraction found it, before any manual correction in the Position field —
   * lets in-tab navigation still recognize the same posting after the user fixed its title.
   * Optional so state saved before it existed still loads (falls back to `job.position`). */
  extractedPosition?: string;
}

function key(tabId: number): string {
  return `tab:${tabId}`;
}

export async function getTabState(tabId: number): Promise<TabState | undefined> {
  const result = await chrome.storage.session.get(key(tabId));
  return result[key(tabId)] as TabState | undefined;
}

export async function setTabState(tabId: number, state: TabState): Promise<void> {
  await chrome.storage.session.set({ [key(tabId)]: state });
}

/** Also drops the tab's Adapt CV selections, so Reset / closing the tab clears both. */
export async function clearTabState(tabId: number): Promise<void> {
  await chrome.storage.session.remove([key(tabId), cvAdaptKey(tabId)]);
}

/** Placeholder values picked for one CV on one posting. */
export interface CvAdaptEntry {
  values: Record<string, string>;
  reasons: Record<string, string>;
  aiSuggested: boolean;
}

/**
 * The Adapt CV tab's per-posting placeholder values, per CV (`byCv`, keyed
 * by CvMeta.id — each CV has its own placeholders) — kept apart from
 * `TabState` (which MainView rewrites wholesale from its own state) but on
 * the same tab key and tier, so a value the user picked for this posting
 * survives going Back, the main view's "adapted CV" export reuses it, and
 * AI suggestions aren't re-bought. `url` guards against reusing values
 * after the tab navigated elsewhere.
 */
export interface CvAdaptState {
  url: string;
  byCv: Record<string, CvAdaptEntry>;
}

function cvAdaptKey(tabId: number): string {
  return `cvAdapt:${tabId}`;
}

export async function getCvAdaptState(tabId: number): Promise<CvAdaptState | undefined> {
  const result = await chrome.storage.session.get(cvAdaptKey(tabId));
  return result[cvAdaptKey(tabId)] as CvAdaptState | undefined;
}

export async function setCvAdaptState(tabId: number, state: CvAdaptState): Promise<void> {
  await chrome.storage.session.set({ [cvAdaptKey(tabId)]: state });
}

/**
 * The Job Search tab's query + results (spec_7 item 15) — deliberately
 * *not* tab-keyed, unlike `TabState` above: opening the Side Panel on a
 * different tab gets its own fresh document (see `background/index.ts`'s
 * per-tab `sidePanel.setOptions`), which would otherwise reset this tool
 * back to empty every time. It's one shared state across every tab, same
 * tier (session storage — cleared on browser restart, not durable like
 * Drive) as `TabState`.
 */
export interface JobSearchState {
  provider: JobSearchProvider;
  what: string;
  where: string;
  remoteOnly: boolean;
  tags: string[];
  results: JobSearchResult[];
  searched: boolean;
  page: number;
  warnings: string[];
  /** Duration of the last search/"More" page; optional so state saved before it existed still loads. */
  timing?: JobSearchTiming | null;
}

const JOB_SEARCH_STATE_KEY = "jobSearchState";

export async function getJobSearchState(): Promise<JobSearchState | undefined> {
  const result = await chrome.storage.session.get(JOB_SEARCH_STATE_KEY);
  return result[JOB_SEARCH_STATE_KEY] as JobSearchState | undefined;
}

export async function setJobSearchState(state: JobSearchState): Promise<void> {
  await chrome.storage.session.set({ [JOB_SEARCH_STATE_KEY]: state });
}
