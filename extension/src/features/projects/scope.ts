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

export async function currentProjectId(): Promise<string> {
  if (resolver) return resolver();
  try {
    const stored = (await chrome.storage.local.get(ACTIVE_PROJECT_KEY))?.[ACTIVE_PROJECT_KEY];
    return isProjectId(stored) ? stored : DEFAULT_PROJECT_ID;
  } catch {
    return DEFAULT_PROJECT_ID;
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
