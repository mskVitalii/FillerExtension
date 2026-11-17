import { useState } from "react";
import { ChevronDown, ChevronRight, Download, Loader2, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CvMeta, CvSettings } from "@/types/profile";
import { CV_LANGUAGE_OPTIONS } from "@/lib/language-codes";
import { useI18n } from "@/i18n/react";
import { displayLanguage } from "@/i18n/core";
import { cvDisplayName } from "@/features/cv-selection/select";

/**
 * One CV in Settings → CVs: the active radio, its language, whether it's the
 * default for that language, and (expanded) its name and rules — what
 * automatic selection matches a posting against.
 */
export function CvLibraryItem({
  cv,
  active,
  switching,
  onActivate,
  onDelete,
  onDownload,
  onSave,
}: {
  cv: CvMeta;
  active: boolean;
  switching: boolean;
  onActivate: () => void;
  onDelete: () => void;
  onDownload: () => Promise<void>;
  onSave: (settings: CvSettings) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(cv.name ?? "");
  const [rules, setRules] = useState(cv.rules ?? "");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const dirty = name !== (cv.name ?? "") || rules !== (cv.rules ?? "");

  async function save(settings: CvSettings) {
    setSaving(true);
    try {
      await onSave(settings);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={cn("flex flex-col gap-2 rounded-md border p-2", active ? "border-primary bg-primary/5" : "border-border")}>
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <input type="radio" name="active-cv" checked={active} disabled={switching} onChange={onActivate} />
          <span className="min-w-0 flex-1 truncate" title={cv.fileName}>
            {cvDisplayName(cv)}
          </span>
          {active && (
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{t("common.active")}</span>
          )}
        </label>
        <Button
          size="sm"
          variant="ghost"
          disabled={downloading}
          onClick={() => {
            setDownloading(true);
            void onDownload().finally(() => setDownloading(false));
          }}
          aria-label={t("cvItem.download")}
          title={t("cvItem.download")}
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label={t("cvItem.delete")}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Select
          className="h-7 w-32 text-xs"
          value={cv.language ?? ""}
          disabled={saving}
          aria-label={t("cvItem.language")}
          onChange={(e) => void save({ language: e.target.value || undefined, isDefaultForLanguage: false })}
        >
          <option value="">{t("cvItem.languagePlaceholder")}</option>
          {CV_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {displayLanguage(locale, option.code)}
            </option>
          ))}
        </Select>
        <button
          type="button"
          disabled={!cv.language || saving}
          onClick={() => void save({ isDefaultForLanguage: !cv.isDefaultForLanguage })}
          className={cn(
            "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs disabled:opacity-40",
            cv.isDefaultForLanguage ? "text-amber-600" : "text-muted-foreground hover:text-foreground",
          )}
          title={cv.language ? t("cvItem.defaultTitle", { language: displayLanguage(locale, cv.language) }) : t("cvItem.pickLanguage")}
        >
          <Star className={cn("h-3.5 w-3.5", cv.isDefaultForLanguage && "fill-current")} />
          {cv.isDefaultForLanguage ? t("cvItem.defaultFor", { language: displayLanguage(locale, cv.language) }) : t("cvItem.makeDefault")}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          {t("cvItem.rules")}{cv.rules?.trim() ? " ✓" : ""}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={cv.fileName}
            className="h-8 text-xs"
            aria-label={t("cvItem.name")}
          />
          <textarea
            className="min-h-14 rounded-md border border-border bg-background p-2 text-xs outline-none"
            placeholder={t("cvItem.rulesPlaceholder")}
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />
          <Button
            size="sm"
            className="w-fit"
            disabled={!dirty || saving}
            onClick={() => void save({ name: name.trim() || undefined, rules: rules.trim() || undefined })}
          >
            {saving ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      )}
    </div>
  );
}
