import { useEffect, useState } from "react";
import type { ActiveTab } from "./useActiveTab";

export interface VisitedTab {
  tabId: number;
  url: string;
}

/** Enough for a batch of applications in parallel without every tab ever opened staying mounted. */
const MAX_VISITED_TABS = 12;

/**
 * Every tab the panel has shown, most recently active last, with each tab's
 * current URL. The panel keeps one MainView mounted per entry (hidden when
 * not active), so switching tabs doesn't abort what another tab was doing —
 * a cover letter generating for tab A keeps streaming while the user works
 * on tab B. A background tab's in-tab navigation still updates its URL, and
 * a closed tab drops out.
 */
export function useVisitedTabs(activeTab: ActiveTab): VisitedTab[] {
  const [tabs, setTabs] = useState<VisitedTab[]>([]);

  useEffect(() => {
    const { tabId, url } = activeTab;
    if (tabId === null) return;
    setTabs((prev) => {
      const rest = prev.filter((t) => t.tabId !== tabId);
      const next = [...rest, { tabId, url: url ?? "" }];
      return next.length > MAX_VISITED_TABS ? next.slice(next.length - MAX_VISITED_TABS) : next;
    });
  }, [activeTab]);

  useEffect(() => {
    function onUpdated(tabId: number, info: chrome.tabs.TabChangeInfo) {
      const url = info.url;
      if (!url) return;
      setTabs((prev) =>
        prev.some((t) => t.tabId === tabId && t.url !== url)
          ? prev.map((t) => (t.tabId === tabId ? { ...t, url } : t))
          : prev,
      );
    }
    function onRemoved(tabId: number) {
      setTabs((prev) => (prev.some((t) => t.tabId === tabId) ? prev.filter((t) => t.tabId !== tabId) : prev));
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    };
  }, []);

  return tabs;
}
