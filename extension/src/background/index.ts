import type { RuntimeMessage } from "@/types/messages";
import { handleContextMenuClick, registerContextMenu } from "./context-menu";
import { cancelElementPicker, routeMessage } from "./router";
import { ensureContentScript } from "./inject-content-script";
import { clearTabState } from "@/features/storage/session";

const SIDE_PANEL_PATH = "src/sidepanel/index.html";

/**
 * Service worker responsibilities (spec section 22): context menus, message
 * routing, extension lifecycle. It must not hold application state only in
 * memory — everything it needs is re-derived from chrome.storage/Drive on
 * each event because Chrome can unload it at any time.
 *
 * The side panel is "contextual": disabled by default on every tab, and
 * only enabled + opened for the specific tab whose action icon was
 * clicked. Without this, `default_path` in the manifest makes Chrome's
 * side panel a per-window surface that stays open across tab switches,
 * showing stale content from whichever tab it was last opened on.
 */
chrome.runtime.onInstalled.addListener(() => {
  registerContextMenu();
  // No tabId = sets the fallback for tabs without tab-specific options,
  // overriding the manifest's implicit "enabled for every tab" default.
  void chrome.sidePanel.setOptions({ enabled: false });
});

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
  void chrome.sidePanel.setOptions({ tabId, path: SIDE_PANEL_PATH, enabled: true });
  void chrome.sidePanel.open({ tabId }).catch((error) => console.error("sidePanel.open failed", error));
  // Runs inside the same activeTab grant — injects now so the content
  // script (and its focus-tracker) is already listening before the user
  // does anything else on this tab, e.g. right-clicking a field. Not
  // awaited: it doesn't need to precede `open`, and blocking on it here is
  // exactly what broke the gesture chain above.
  void ensureContentScript(tabId);
});

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
