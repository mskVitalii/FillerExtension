import { mergeFillRuns, type FillRun } from "./stats";

const KEY = "fillStats";

/** This browser's own autofill runs (newest 500), recorded by the background from the content script's reports. */
export async function getFillRuns(): Promise<FillRun[]> {
  const stored = (await chrome.storage.local.get(KEY))[KEY] as FillRun[] | undefined;
  return Array.isArray(stored) ? stored : [];
}

export async function recordFillRun(run: FillRun): Promise<void> {
  if (run.fields.length === 0) return;
  await chrome.storage.local.set({ [KEY]: mergeFillRuns(await getFillRuns(), [run]) });
}

export const FILL_STATS_STORAGE_KEY = KEY;
