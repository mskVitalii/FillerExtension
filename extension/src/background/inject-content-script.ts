/**
 * On-demand content script injection (activeTab + scripting, not a
 * broad-matching `content_scripts` manifest entry — see
 * vite.content.config.ts). Must be called from a handler that's running
 * within a granted activeTab window for `tabId` — an action click, a
 * context-menu click, or a later message on a tab that already had one
 * of those — otherwise Chrome rejects the injection.
 *
 * `allFrames: true` — a great many ATS/application forms live inside an
 * iframe (embedded Greenhouse/Lever/Workday/SmartRecruiters widgets,
 * career-page embeds). Without it, extraction/autofill/insert only ever see
 * the top document and silently miss any field or job text in a subframe.
 *
 * What that reaches is decided by permissions, not by this call: the
 * activeTab grant is for the *top frame's origin* only. Same-origin
 * subframes (and about:blank/srcdoc ones) get the script; a cross-origin
 * iframe (careers.acme.com embedding boards.greenhouse.io) is silently
 * skipped unless the user also granted that origin through
 * `optional_host_permissions` — see `findBlockedFrameOrigins` below and
 * the Side Panel's FrameAccessBanner. No `content_scripts` entry and no
 * required broad host permission is involved.
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

/**
 * Runs in every reachable frame (serialized by `executeScript`, so it must
 * be self-contained): reports the frame's own origin and the child iframes
 * big enough to hold a form — a tracking pixel or a 1×1 consent bridge is
 * never what the user meant.
 */
function listChildFrames(): { origin: string; children: { src: string; area: number }[] } {
  const children: { src: string; area: number }[] = [];
  for (const frame of Array.from(document.querySelectorAll<HTMLIFrameElement>("iframe, frame"))) {
    const rect = frame.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (frame.src && rect.width >= 200 && rect.height >= 150) children.push({ src: frame.src, area });
  }
  return { origin: location.origin, children };
}

/**
 * Origins of visible cross-origin iframes this extension can't script yet:
 * the activeTab grant didn't cover them and the user hasn't granted them as
 * an optional host permission. Largest first, at most three — the Side
 * Panel offers a one-click grant for these (`chrome.permissions.request`
 * needs the panel's own click, so it can't happen here).
 */
export async function findBlockedFrameOrigins(tabId: number): Promise<string[]> {
  let results: chrome.scripting.InjectionResult<ReturnType<typeof listChildFrames>>[];
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: listChildFrames });
  } catch {
    return [];
  }
  const reached = new Set<string>();
  const area = new Map<string, number>();
  for (const { result } of results) {
    if (!result) continue;
    reached.add(result.origin);
    for (const child of result.children) {
      let origin: string;
      try {
        const url = new URL(child.src);
        if (url.protocol !== "https:" && url.protocol !== "http:") continue;
        origin = url.origin;
      } catch {
        continue;
      }
      area.set(origin, Math.max(area.get(origin) ?? 0, child.area));
    }
  }

  const blocked: string[] = [];
  for (const origin of [...area.keys()].sort((a, b) => area.get(b)! - area.get(a)!)) {
    if (reached.has(origin)) continue;
    const granted = await chrome.permissions.contains({ origins: [`${origin}/*`] }).catch(() => false);
    if (!granted) blocked.push(origin);
    if (blocked.length === 3) break;
  }
  return blocked;
}
