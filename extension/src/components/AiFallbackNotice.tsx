import { useEffect, useState } from "react";
import { Info, X } from "lucide-react";
import { FALLBACK_NOTICE_KEY, type FallbackNotice } from "@/features/openai/fallback";
import { useT } from "@/i18n/react";

/** How long a notice stays up on its own. */
const SHOW_MS = 20_000;

/**
 * "OpenAI was unavailable — answered by Claude": shown at the bottom of the panel whenever an AI
 * call fell back (`withClaudeFallback` writes the notice to session storage, from whichever
 * context ran the call). Only notices that arrive while the panel is open are shown.
 */
export function AiFallbackNotice() {
  const t = useT();
  const [notice, setNotice] = useState<FallbackNotice | null>(null);

  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const next = changes[FALLBACK_NOTICE_KEY]?.newValue as FallbackNotice | undefined;
      if (area === "session" && next) setNotice(next);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), SHOW_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  if (!notice) return null;
  return (
    <div role="status" className="fixed inset-x-2 bottom-2 z-50 flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs shadow-lg">
      <Info className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <span className="flex-1">
        {t("fallback.notice", { reason: notice.reason, model: notice.model })}
        {notice.label ? <span className="text-muted-foreground"> — {notice.label}</span> : null}
      </span>
      <button type="button" aria-label={t("common.close")} className="text-muted-foreground hover:text-foreground" onClick={() => setNotice(null)}>
        <X className="size-3.5" />
      </button>
    </div>
  );
}
