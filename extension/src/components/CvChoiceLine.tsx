import { Loader2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { CvMeta } from "@/types/profile";
import { cvDisplayName, type CvChoice } from "@/features/cv-selection/select";
import { useI18n } from "@/i18n/react";
import { displayLanguage } from "@/i18n/core";

/** "CV: [German Backend ▾] · German posting" — the CV picked for this posting, changeable in place. */
export function CvChoiceLine({
  cvs,
  activeId,
  choice,
  choosing,
  onChange,
}: {
  cvs: CvMeta[];
  activeId: string | null;
  choice: CvChoice | null;
  choosing: boolean;
  onChange: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const language = displayLanguage(locale, choice?.language);
  const note = choosing
    ? t("cvChoice.choosing")
    : !choice
      ? null
      : choice.source === "manual"
        ? t("cvChoice.manual")
        : choice.source === "ai"
          ? t("cvChoice.ai", { reason: choice.reason })
          : choice.fallback
            ? t("cvChoice.fallback", { language })
            : choice.source === "rules"
              ? t("cvChoice.rules", { language })
              : t("cvChoice.language", { language });
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{t("main.cv")}</span>
      <Select
        className="h-7 min-w-0 flex-1 text-xs"
        value={activeId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label={t("cvChoice.label")}
      >
        {cvs.map((cv) => (
          <option key={cv.id} value={cv.id}>
            {cvDisplayName(cv)}
            {cv.language ? ` (${displayLanguage(locale, cv.language)})` : ""}
          </option>
        ))}
      </Select>
      {note && (
        <span className="flex shrink-0 items-center gap-1 truncate text-muted-foreground" title={note}>
          {choosing && <Loader2 className="size-3 animate-spin" />}
          {note}
        </span>
      )}
    </div>
  );
}
