import { useEffect, useState } from "react";

/**
 * `chrome.action.onUserSettingsChanged` (Chrome 130+) isn't in the
 * `@types/chrome` version this project pins, and older Chromes don't have
 * it at all — so it's read through this narrower shape and treated as
 * optional.
 */
type UserSettingsEvent = chrome.events.Event<(change: Partial<chrome.action.UserSettings>) => void>;

/**
 * Whether the user has pinned Filler's icon to Chrome's toolbar, or `null`
 * while that's still unknown. Chrome deliberately offers no API to pin an
 * extension, and a freshly installed one lands hidden in the Extensions
 * (puzzle-piece) menu — so the most the panel can do is ask the user and
 * stop asking once `isOnToolbar` turns true. Updates live through
 * `onUserSettingsChanged`; where that event doesn't exist, re-checks
 * whenever the panel regains focus (i.e. after the user was in the toolbar).
 */
export function useToolbarPinned(): boolean | null {
  const [pinned, setPinned] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;

    // The change event only carries the fields that changed, hence Partial.
    function apply(settings: Partial<chrome.action.UserSettings>) {
      if (!cancelled && settings.isOnToolbar !== undefined) setPinned(settings.isOnToolbar);
    }
    function sync() {
      chrome.action.getUserSettings().then(apply, () => {
        // Unsupported (pre-Chrome 91) — never nag about something we can't observe.
        if (!cancelled) setPinned(true);
      });
    }

    sync();

    const onChanged = (chrome.action as { onUserSettingsChanged?: UserSettingsEvent }).onUserSettingsChanged;
    if (onChanged) {
      onChanged.addListener(apply);
      return () => {
        cancelled = true;
        onChanged.removeListener(apply);
      };
    }
    window.addEventListener("focus", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", sync);
    };
  }, []);

  return pinned;
}
