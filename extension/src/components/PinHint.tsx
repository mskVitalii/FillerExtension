import { Pin, Puzzle } from "lucide-react";
import { useT } from "@/i18n/react";

/**
 * Asks the user to pin Filler's icon, since Chrome can't be told to do it:
 * a new extension starts hidden in the Extensions menu, and the icon is the
 * only way to open this panel on another job page. Shown only while
 * `useToolbarPinned()` reports the icon isn't on the toolbar.
 */
export function PinHint() {
  const t = useT();
  return (
    <p className="flex items-start gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
      <Pin className="mt-0.5 size-3 shrink-0" />
      <span>
        <span className="font-medium text-foreground">{t("pin.title")}</span> — {t("pin.click")}{" "}
        <Puzzle className="inline size-3 align-[-2px]" aria-label="Extensions" /> {t("pin.rest")}
      </span>
    </p>
  );
}
