import { DEFAULT_PROJECT_ID, isProjectId, scopedDriveName, scopedStorageKey } from "./registry";

/**
 * Which project the code runs in. In the extension that's this browser's active project
 * (`chrome.storage.local.activeProjectId`, absent = Default); the agent installs its own resolver
 * (the project of the job or request it's serving). Every project-scoped storage key and Drive
 * file name goes through here (`storage/local.ts`, `google-drive/client.ts`), so the repositories
 * don't pass a project around.
 */

export const ACTIVE_PROJECT_KEY = "activeProjectId";

let resolver: (() => string | Promise<string>) | null = null;

export function setProjectResolver(fn: (() => string | Promise<string>) | null): void {
  resolver = fn;
}

/** This browser's active project as stored, whatever run is pinned right now. */
export async function readActiveProjectId(): Promise<string> {
  try {
    const stored = (await chrome.storage.local.get(ACTIVE_PROJECT_KEY))?.[ACTIVE_PROJECT_KEY];
    return isProjectId(stored) ? stored : DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
  }
}

export async function currentProjectId(): Promise<string> {
  if (pin) return pin.id;
  if (resolver) return resolver();
  return readActiveProjectId();
}

/**
 * Background runs bound to the project they were started in. A cover letter streams for half a
 * minute; if the user switches project meanwhile, its reads (profile, CV, legend, rules) and
 * writes (the last letter, FAQ answers) must still be the starting project's. Browsers have no
 * AsyncLocalStorage, so the service worker holds one pin at a time: runs of the same project share
 * it, and a run of another project waits until they're done. Only a switch in the middle of a run
 * ever makes anything wait.
 */
let pin: { id: string; count: number } | null = null;
let waiting: (() => void)[] = [];

export async function runInProject<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const id = isProjectId(projectId) ? projectId : DEFAULT_PROJECT_ID;
  while (pin && pin.id !== id) await new Promise<void>((resolve) => waiting.push(resolve));
  pin ??= { id, count: 0 };
  const held = pin;
  held.count += 1;
  try {
    return await fn();
  } finally {
    held.count -= 1;
    if (held.count === 0 && pin === held) {
      pin = null;
      const wake = waiting;
      waiting = [];
      for (const resolve of wake) resolve();
    }
  }
}

/** `key` in the current project's storage (Default's keys keep their names). */
export async function projectStorageKey(key: string): Promise<string> {
  return scopedStorageKey(key, await currentProjectId());
}

/** `name` in the current project's Drive files (Default's stay at the root). */
export async function projectDriveName(name: string): Promise<string> {
  return scopedDriveName(name, await currentProjectId());
}
