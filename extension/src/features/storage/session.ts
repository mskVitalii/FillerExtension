import type { Job, JobLanguageInfo } from "@/types/job";
import type { CustomQuestion } from "@/features/autofill/custom-questions";
import type { CheckboxDecision } from "@/features/openai/decide-checkboxes";
import type { CvChoice } from "@/features/cv-selection/select";
import type { JobGrade, JobSearchProvider, JobSearchResult, JobSearchTiming } from "@/types/job-search";

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
  /** Drafted outreach message to the posting's recruiter/hiring contact, if generated — optional so state saved before it existed still loads. */
  outreachMessage?: { subject: string | null; body: string } | null;
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
  /** Same as `extractedPosition`, for a hand-corrected Company field. */
  extractedCompany?: string;
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
  await chrome.storage.session.remove([key(tabId), cvAdaptKey(tabId), coverLetterRunKey(tabId), cvChoiceKey(tabId)]);
}

/**
 * Which CV this tab's posting uses (`features/cv-selection`) — picked
 * automatically from the posting's language/rules, or by hand (`source:
 * "manual"`, never overridden by a later automatic pick). The library's
 * active CV is global, so the panel re-applies this whenever the tab comes
 * back into view. `url` ties it to the posting.
 */
export interface CvChoiceState {
  url: string;
  choice: CvChoice;
}

function cvChoiceKey(tabId: number): string {
  return `cvChoice:${tabId}`;
}

export async function getCvChoiceState(tabId: number): Promise<CvChoiceState | undefined> {
  const result = await chrome.storage.session.get(cvChoiceKey(tabId));
  return result[cvChoiceKey(tabId)] as CvChoiceState | undefined;
}

export async function setCvChoiceState(tabId: number, state: CvChoiceState): Promise<void> {
  await chrome.storage.session.set({ [cvChoiceKey(tabId)]: state });
}

/**
 * A cover-letter generation for one tab, written by the background as it
 * runs. The Side Panel lives only as long as Chrome keeps it, so a panel
 * that was unloaded mid-generation (the user went to another tab) and comes
 * back reads the progress — or the finished letter — from here instead of
 * losing it. `jobUrl` ties it to the posting it was generated for.
 */
export interface CoverLetterRun {
  jobUrl: string;
  /** "applied" once a panel showed the finished letter — a later panel must not overwrite edits with it. */
  status: "generating" | "done" | "error" | "applied";
  /** The text so far while generating; the final, authoritative text once done. */
  content: string;
  error?: string;
  /** Patterns the slop cleaner rewrote, for the "cleaned up" notice. */
  cleanedPatterns?: string[];
}

export function coverLetterRunKey(tabId: number): string {
  return `coverLetterRun:${tabId}`;
}

export async function getCoverLetterRun(tabId: number): Promise<CoverLetterRun | undefined> {
  const result = await chrome.storage.session.get(coverLetterRunKey(tabId));
  return result[coverLetterRunKey(tabId)] as CoverLetterRun | undefined;
}

export async function setCoverLetterRun(tabId: number, run: CoverLetterRun): Promise<void> {
  await chrome.storage.session.set({ [coverLetterRunKey(tabId)]: run });
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
 * *not* tab-keyed, unlike `TabState` above: the panel is window-wide, so a
 * search belongs to no tab, and a panel opened in another window (a fresh
 * document) would otherwise start empty. It's one shared state across every tab, same
 * tier (session storage — cleared on browser restart, not durable like
 * Drive) as `TabState`.
 */
export interface JobSearchState {
  provider: JobSearchProvider;
  what: string;
  where: string;
  remoteOnly: boolean;
  /** Optional so state saved before grades existed still loads. */
  grades?: JobGrade[];
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
