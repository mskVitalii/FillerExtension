import type { RuntimeMessage } from "@/types/messages";
import { handleContextMenuClick, registerContextMenu } from "./context-menu";
import { cancelElementPicker, routeMessage } from "./router";
import { ensureContentScript } from "./inject-content-script";
import { clearTabState } from "@/features/storage/session";
import { registerUpdateCheck } from "./updates";
import { isLinkedInCollectorSettingsChange, syncLinkedInCollector } from "@/features/linkedin-collector/registration";

const SIDE_PANEL_PATH = "src/sidepanel/index.html";

/**
 * Service worker responsibilities (spec section 22): context menus, message
 * routing, extension lifecycle. It must not hold application state only in
 * memory — everything it needs is re-derived from chrome.storage/Drive on
 * each event because Chrome can unload it at any time.
 *
 * The side panel is "contextual": disabled by default on every tab, and
 * only enabled + opened for the specific tab whose action icon was clicked,
 * with that tab's id in the panel URL so the panel stays bound to it (see
 * the Side Panel's `useActiveTab`). Work that must outlive the panel — a
 * cover letter generating while the user is on another tab — runs here and
 * records its progress per tab in session storage (`CoverLetterRun`).
 */
chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu();
  // No tabId = sets the fallback for tabs without tab-specific options,
  // overriding the manifest's implicit "enabled for every tab" default.
  void chrome.sidePanel.setOptions({ enabled: false });
  void syncLinkedInCollector().catch((error) => console.error("LinkedIn collector sync failed", error));
});

/**
 * The on-page LinkedIn collector is registered only while the user has it switched on and the
 * `https://www.linkedin.com/*` host permission is granted (features/linkedin-collector/registration.ts).
 * Re-checked whenever either can have changed — and on browser start, since an extension update
 * can drop dynamically registered scripts.
 */
function resyncLinkedInCollector(): void {
  void syncLinkedInCollector().catch((error) => console.error("LinkedIn collector sync failed", error));
}
chrome.runtime.onStartup.addListener(resyncLinkedInCollector);
chrome.permissions.onAdded.addListener(resyncLinkedInCollector);
chrome.permissions.onRemoved.addListener(resyncLinkedInCollector);
chrome.storage.onChanged.addListener((changes, area) => {
  if (isLinkedInCollectorSettingsChange(changes, area)) resyncLinkedInCollector();
});

// Version check against GitHub releases (or the Web Store) + the NEW badge — docs/updates.md.
registerUpdateCheck();

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuClick(info, tab);
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  // `sidePanel.open()` is only honored as a direct response to the click's
  // user gesture — any `await` before it (even a fast one) risks Chrome no
  // longer treating it as gesture-triggered, so nothing async may precede
  // it in this listener. `setOptions` must be issued first for `open` to
  // find the panel enabled, but neither call is awaited here — awaiting
  // would yield control back to the event loop between them.
  // Tab-specific: the panel shows on this tab only, and the `tabId` in its URL pins the panel to
  // it — it never follows the active tab, so another tab can't take over (or reset) its work.
  void chrome.sidePanel.setOptions({ tabId, path: `${SIDE_PANEL_PATH}?tabId=${tabId}`, enabled: true });
  void chrome.sidePanel.open({ tabId }).catch((error) => console.error("sidePanel.open failed", error));
  // Runs inside the same activeTab grant — injects now so the content
  // script (and its focus-tracker) is already listening before the user
  // does anything else on this tab, e.g. right-clicking a field. Not
  // awaited: it doesn't need to precede `open`, and blocking on it here is
  // exactly what broke the gesture chain above.
  void injectAndAnnounce(tabId);
});

/**
 * The click is also how a tab the panel couldn't read yet (no activeTab
 * grant, no host permission) becomes readable — the already-open panel
 * learns it can retry from this broadcast.
 */
async function injectAndAnnounce(tabId: number): Promise<void> {
  await ensureContentScript(tabId);
  const message: RuntimeMessage = { type: "TAB_ACCESS_GRANTED", tabId };
  // Rejects when no panel is open to receive it — nothing to do then.
  await chrome.runtime.sendMessage(message).catch(() => undefined);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabState(tabId);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  // A rejected `routeMessage` (an OpenAI call throwing, a quota/verification
  // error, a network failure…) must not leave `sendResponse` uncalled —
  // that closes the port with no reply and the caller's `sendMessage`
  // silently resolves to `undefined`, so every AI failure looks like "no
  // answer" instead of surfacing its reason. Reply with a typed ERROR
  // envelope that `sendMessage` turns back into a thrown Error.
  routeMessage(message)
    .then(sendResponse)
    .catch((error: unknown) => {
      sendResponse({
        type: "ERROR",
        error: error instanceof Error ? error.message : String(error),
        code: error instanceof Error ? error.name : undefined,
      });
    });
  return true;
});

// The Side Panel opens a `picker-<tabId>` port while element-picker mode is
// active. If the panel closes (or the window is shut) the port disconnects
// and we tear down the on-page overlay, which no message could otherwise do.
chrome.runtime.onConnect.addListener((port) => {
  const match = /^picker-(\d+)$/.exec(port.name);
  if (!match) return;
  const tabId = Number(match[1]);
  port.onDisconnect.addListener(() => {
    void cancelElementPicker(tabId);
  });
});
