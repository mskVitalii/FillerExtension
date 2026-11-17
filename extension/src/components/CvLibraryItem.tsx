import { useState } from "react";
import { ChevronDown, ChevronRight, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CvMeta, CvSettings } from "@/types/profile";
import { CV_LANGUAGE_OPTIONS, languageName } from "@/lib/language-codes";
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
  onSave,
}: {
  cv: CvMeta;
  active: boolean;
  switching: boolean;
  onActivate: () => void;
  onDelete: () => void;
  onSave: (settings: CvSettings) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(cv.name ?? "");
  const [rules, setRules] = useState(cv.rules ?? "");
  const [saving, setSaving] = useState(false);
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
            <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Active</span>
          )}
        </label>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Delete CV">
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Select
          className="h-7 w-32 text-xs"
          value={cv.language ?? ""}
          disabled={saving}
          aria-label="CV language"
          onChange={(e) => void save({ language: e.target.value || undefined, isDefaultForLanguage: false })}
        >
          <option value="">Language…</option>
          {CV_LANGUAGE_OPTIONS.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
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
          title={cv.language ? `Default CV for ${languageName(cv.language)} postings` : "Pick a language first"}
        >
          <Star className={cn("h-3.5 w-3.5", cv.isDefaultForLanguage && "fill-current")} />
          {cv.isDefaultForLanguage ? `Default for ${languageName(cv.language)}` : "Make default"}
        </button>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          Rules{cv.rules?.trim() ? " ✓" : ""}
        </button>
      </div>
      {open && (
        <div className="flex flex-col gap-1.5">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={cv.fileName}
            className="h-8 text-xs"
            aria-label="CV name"
          />
          <textarea
            className="min-h-14 rounded-md border border-border bg-background p-2 text-xs outline-none"
            placeholder="Which postings is this CV for? e.g. Backend roles with Go or Kotlin, fintech, startups…"
            value={rules}
            onChange={(e) => setRules(e.target.value)}
          />
          <Button
            size="sm"
            className="w-fit"
            disabled={!dirty || saving}
            onClick={() => void save({ name: name.trim() || undefined, rules: rules.trim() || undefined })}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
