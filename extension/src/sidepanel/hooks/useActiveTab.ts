import { useEffect, useState } from "react";

export interface ActiveTab {
  tabId: number | null;
  url: string | null;
}

/** The tab this panel was opened for — `background/index.ts` puts it in the panel URL. */
function boundTabId(): number | null {
  const raw = new URLSearchParams(location.search).get("tabId");
  const id = raw ? Number(raw) : NaN;
  return Number.isInteger(id) ? id : null;
}

/**
 * The tab this side panel instance represents. A panel opened from the
 * toolbar is tab-specific and bound to its tab for life: it follows that
 * tab's own navigation (`onUpdated`, e.g. clicking through to the
 * application form) but never another tab, so switching away and back finds
 * the same work instead of a reset. Without a bound tab (the options page
 * opened in a tab of its own), it falls back to tracking the active tab.
 */
export function useActiveTab(): ActiveTab {
  const [state, setState] = useState<ActiveTab>({ tabId: null, url: null });

  useEffect(() => {
    let cancelled = false;
    const bound = boundTabId();

    async function sync() {
      const tab =
        bound !== null
          ? await chrome.tabs.get(bound).catch(() => undefined)
          : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
      if (!cancelled) setState({ tabId: tab?.id ?? bound, url: tab?.url ?? null });
    }

    void sync();

    function onActivated() {
      if (bound === null) void sync();
    }
    function onUpdated(tabId: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
      if (!info.url) return;
      if (bound !== null ? tabId === bound : tab.active) void sync();
    }

    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, []);

  return state;
}
