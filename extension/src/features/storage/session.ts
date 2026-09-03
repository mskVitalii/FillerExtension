import type { Job, JobLanguageInfo } from "@/types/job";
import type { CustomQuestion } from "@/features/autofill/custom-questions";
import type { CheckboxDecision } from "@/features/openai/decide-checkboxes";

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

export async function clearTabState(tabId: number): Promise<void> {
  await chrome.storage.session.remove(key(tabId));
}
