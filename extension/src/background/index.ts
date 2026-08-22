import type { RuntimeMessage } from "@/types/messages";
import { handleContextMenuClick, registerContextMenu } from "./context-menu";
import { routeMessage } from "./router";
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

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id === undefined) return;
  await chrome.sidePanel.setOptions({ tabId: tab.id, path: SIDE_PANEL_PATH, enabled: true });
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTabState(tabId);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  routeMessage(message).then(sendResponse);
  return true;
});
