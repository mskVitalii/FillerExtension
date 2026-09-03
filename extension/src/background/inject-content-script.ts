/**
 * On-demand content script injection (activeTab + scripting, not a
 * broad-matching `content_scripts` manifest entry — see
 * vite.content.config.ts). Must be called from a handler that's running
 * within a granted activeTab window for `tabId` — an action click, a
 * context-menu click, or a later message on a tab that already had one
 * of those — otherwise Chrome rejects the injection.
 *
 * `allFrames: true` — activeTab's grant covers every frame in the tab
 * regardless of origin (it's a tab-wide grant, not an origin allowlist like
 * host_permissions), and a great many ATS/application forms live inside an
 * iframe (embedded Greenhouse/Lever/Workday widgets, career-page embeds).
 * Without this, extraction/autofill/insert only ever see the top document
 * and silently miss any field or job text that lives in a subframe.
 *
 * Safe to call even if the script is already present: content/index.ts
 * guards its own top-level side effects against double-registration.
 *
 * Returns the frame ids it actually reached (main frame included) —
 * `InjectionResult` reports `frameId` per frame regardless of file-based vs.
 * function-based injection, so callers that need to message every frame
 * (router.ts's `sendToAllFrames`) can reuse this instead of a second
 * `executeScript` probe (and the `webNavigation` permission that would
 * otherwise take to enumerate frames).
 */
export async function ensureContentScript(tabId: number): Promise<number[]> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content-script.js"],
    });
    const frameIds = results.map((r) => r.frameId).filter((id): id is number => typeof id === "number");
    if (frameIds.length > 0) return frameIds;
  } catch {
    // `allFrames: true` injection failed for the *whole* call — some Chrome
    // versions treat one uninjectable subframe (an ad/tracking/chat-widget
    // iframe, a cross-origin embed that refuses scripting, ...) as a reason
    // to reject the entire request, main frame included. That would have
    // silently killed extraction/autofill on any page with such an iframe
    // — which is most of them — so fall through to a main-frame-only retry
    // instead of giving up here.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content-script.js"],
    });
    return [0];
  } catch {
    // Restricted page (chrome://, Web Store, PDF viewer, ...) or no
    // activeTab grant for this tab yet — caller's subsequent
    // tabs.sendMessage will fail too and surface its own error state. Still
    // return frame 0 rather than an empty list: on a tab where the content
    // script is already live from an earlier interaction, a fresh
    // injection attempt can error for reasons unrelated to whether
    // messaging that frame will actually work.
    return [0];
  }
}
