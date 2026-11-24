/**
 * Turns the on-page LinkedIn collector on and off. Nothing about it is in `manifest.json`'s
 * install-time permissions: `https://www.linkedin.com/*` is one of the `optional_host_permissions`
 * (already covered by its `https://*\/*` entry), granted with one click in the Side Panel, and the
 * collector script is registered with `chrome.scripting.registerContentScripts` only while both
 * hold:
 *  - the host permission is granted, and
 *  - the user switched the collector on (`linkedinCollector.enabled`) — so someone who once granted
 *    "all sites" for autofill doesn't get buttons on LinkedIn they never asked for.
 *
 * `syncLinkedInCollector` is idempotent and runs on install/update, browser start, a permission
 * change and a change of the switch (background/index.ts).
 */

export const LINKEDIN_ORIGINS = ["https://www.linkedin.com/*"];
export const LINKEDIN_SCRIPT_ID = "filler-linkedin-collector";
/** Built by vite.linkedin.config.ts into the root of `dist/`. */
export const LINKEDIN_SCRIPT_FILE = "linkedin-collector.js";
const SETTINGS_KEY = "linkedinCollector";

export interface LinkedInCollectorSettings {
  enabled: boolean;
}

export function hasLinkedInPermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: LINKEDIN_ORIGINS });
}

/** Must be the first call of a click handler — `permissions.request` needs the user gesture. */
export function requestLinkedInPermission(): Promise<boolean> {
  return chrome.permissions.request({ origins: LINKEDIN_ORIGINS });
}

export async function getLinkedInCollectorSettings(): Promise<LinkedInCollectorSettings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<LinkedInCollectorSettings> | undefined;
  return { enabled: stored?.enabled === true };
}

export async function setLinkedInCollectorEnabled(enabled: boolean): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: { enabled } satisfies LinkedInCollectorSettings });
}

export function isLinkedInCollectorSettingsChange(changes: Record<string, unknown>, area: string): boolean {
  return area === "local" && SETTINGS_KEY in changes;
}

/**
 * Registers or unregisters the collector to match the permission and the switch. When it was just
 * registered, also injects it into LinkedIn tabs already open (a registered script only reaches
 * pages loaded after it), so the buttons appear without a reload.
 */
export async function syncLinkedInCollector(): Promise<"registered" | "unregistered" | "unchanged"> {
  const [granted, settings, existing] = await Promise.all([
    hasLinkedInPermission(),
    getLinkedInCollectorSettings(),
    chrome.scripting.getRegisteredContentScripts({ ids: [LINKEDIN_SCRIPT_ID] }),
  ]);
  const want = granted && settings.enabled;
  if (want && existing.length === 0) {
    await chrome.scripting.registerContentScripts([
      {
        id: LINKEDIN_SCRIPT_ID,
        // The whole host, not just /jobs/*: LinkedIn is a single-page app, and a search opened from
        // the feed never reloads the page. The script itself stays idle off the jobs pages.
        matches: LINKEDIN_ORIGINS,
        js: [LINKEDIN_SCRIPT_FILE],
        runAt: "document_idle",
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
    await injectIntoOpenTabs();
    return "registered";
  }
  if (!want && existing.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [LINKEDIN_SCRIPT_ID] });
    // Already-open pages keep the script until they reload; tell them to take their UI down now.
    await broadcastToOpenTabs({ type: "LINKEDIN_COLLECTOR_OFF" });
    return "unregistered";
  }
  return "unchanged";
}

async function linkedInTabs(): Promise<number[]> {
  const tabs = await chrome.tabs.query({ url: LINKEDIN_ORIGINS });
  return tabs.map((tab) => tab.id).filter((id): id is number => id !== undefined);
}

async function injectIntoOpenTabs(): Promise<void> {
  for (const tabId of await linkedInTabs()) {
    await chrome.scripting.executeScript({ target: { tabId }, files: [LINKEDIN_SCRIPT_FILE] }).catch(() => undefined);
  }
}

async function broadcastToOpenTabs(message: { type: "LINKEDIN_COLLECTOR_OFF" }): Promise<void> {
  for (const tabId of await linkedInTabs()) {
    await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
  }
}
