import { useEffect, useState } from "react";
import { getUpdateSnapshot, UPDATE_STORAGE_KEYS, type UpdateSnapshot } from "@/features/updates/check";

/**
 * The update check's current result (`features/updates/check.ts`), kept live:
 * the background's alarm, another panel or a dismiss all land in
 * `chrome.storage.local`, and this re-reads on any of those keys changing.
 */
export function useUpdateSnapshot(): UpdateSnapshot | null {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      void getUpdateSnapshot().then(
        (next) => !cancelled && setSnapshot(next),
        () => undefined,
      );
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && UPDATE_STORAGE_KEYS.some((key) => key in changes)) load();
    };
    load();
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  return snapshot;
}
