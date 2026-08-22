import { useEffect, useState } from "react";

export interface ActiveTab {
  tabId: number | null;
  url: string | null;
}

/**
 * Tracks which tab this side panel instance should represent right now.
 * The panel is one shared document that stays mounted while the user
 * switches tabs/windows, so without this it would keep showing whatever
 * tab it last fetched for. Re-run on both tab switches (`onActivated`) and
 * in-tab navigation (`onUpdated`, e.g. clicking a new job link) so the
 * `url` changes too, letting callers tell "same page" apart from
 * "same tab, different job".
 */
export function useActiveTab(): ActiveTab {
  const [state, setState] = useState<ActiveTab>({ tabId: null, url: null });

  useEffect(() => {
    let cancelled = false;

    async function sync() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!cancelled) setState({ tabId: tab?.id ?? null, url: tab?.url ?? null });
    }

    void sync();

    function onActivated() {
      void sync();
    }
    function onUpdated(_tabId: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) {
      if (tab.active && info.url) void sync();
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
