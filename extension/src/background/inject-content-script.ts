/**
 * On-demand content script injection (activeTab + scripting, not a
 * broad-matching `content_scripts` manifest entry — see
 * vite.content.config.ts). Must be called from a handler that's running
 * within a granted activeTab window for `tabId` — an action click, a
 * context-menu click, or a later message on a tab that already had one
 * of those — otherwise Chrome rejects the injection.
 *
 * Safe to call even if the script is already present: content/index.ts
 * guards its own top-level side effects against double-registration.
 */
export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
  } catch {
    // Restricted page (chrome://, Web Store, PDF viewer, ...) or no
    // activeTab grant for this tab yet — caller's subsequent
    // tabs.sendMessage will fail too and surface its own error state.
  }
}
