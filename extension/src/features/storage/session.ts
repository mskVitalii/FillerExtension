import type { Job } from "@/types/job";

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
