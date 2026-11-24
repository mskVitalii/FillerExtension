import {
  currentVersion,
  getUpdateSnapshot,
  isStoreInstall,
  recordStoreUpdate,
  runUpdateCheck,
  syncUpdateBadge,
} from "@/features/updates/check";

/**
 * Service-worker side of the update check (`docs/updates.md`). Everything is
 * re-derived from `chrome.storage.local` on each event — the worker can be
 * unloaded between any two of them.
 */

const ALARM_NAME = "filler-update-check";
const CHECK_EVERY_MINUTES = 6 * 60;

export function registerUpdateCheck(): void {
  chrome.runtime.onInstalled.addListener(() => {
    void ensureAlarm();
    // Also how the badge clears right after the user installed the new version.
    void runUpdateCheck({ force: true }).catch(logError);
  });

  chrome.runtime.onStartup.addListener(() => {
    void ensureAlarm();
    // The badge doesn't survive a browser restart; re-derive it, then refresh.
    void syncUpdateBadge().catch(logError);
    void runUpdateCheck().catch(logError);
  });

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== ALARM_NAME) return;
    void runUpdateCheck({ force: true })
      .then(() => applyStoreUpdateIfIdle())
      .catch(logError);
  });

  // Web Store installs only. With a listener here, Chrome no longer applies
  // the downloaded update on its own when the worker idles — it waits for
  // `runtime.reload()` or a browser restart. So: apply it at once when no
  // Filler page is open (nothing visible to lose), else badge it and let
  // the panel offer "Reload to update"; the alarm retries once it's closed.
  chrome.runtime.onUpdateAvailable.addListener((details) => {
    void recordStoreUpdate(details.version)
      .then(() => applyStoreUpdateIfIdle())
      .catch(logError);
  });
}

async function ensureAlarm(): Promise<void> {
  // Re-creating an alarm of the same name resets its schedule, so only create a missing one.
  if (await chrome.alarms.get(ALARM_NAME)) return;
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: CHECK_EVERY_MINUTES, periodInMinutes: CHECK_EVERY_MINUTES });
}

async function applyStoreUpdateIfIdle(): Promise<void> {
  if (!isStoreInstall()) return;
  const { offer } = await getUpdateSnapshot();
  if (offer?.kind !== "store" || offer.version === currentVersion()) return;
  const open = await chrome.runtime.getContexts({
    contextTypes: [
      chrome.runtime.ContextType.SIDE_PANEL,
      chrome.runtime.ContextType.TAB,
      chrome.runtime.ContextType.POPUP,
      chrome.runtime.ContextType.OFFSCREEN_DOCUMENT,
    ],
  });
  if (open.length === 0) chrome.runtime.reload();
}

function logError(error: unknown): void {
  console.warn("Filler update check failed", error);
}
