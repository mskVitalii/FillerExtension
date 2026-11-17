import { Loader2 } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { CvMeta } from "@/types/profile";
import { cvDisplayName, type CvChoice } from "@/features/cv-selection/select";
import { languageName } from "@/lib/language-codes";

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
  const note = choosing
    ? "choosing…"
    : !choice
      ? null
      : choice.source === "manual"
        ? "chosen by you"
        : choice.source === "ai"
          ? `AI: ${choice.reason}`
          : choice.reason;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="shrink-0 text-muted-foreground">CV</span>
      <Select
        className="h-7 min-w-0 flex-1 text-xs"
        value={activeId ?? ""}
        onChange={(e) => onChange(e.target.value)}
        aria-label="CV for this posting"
      >
        {cvs.map((cv) => (
          <option key={cv.id} value={cv.id}>
            {cvDisplayName(cv)}
            {cv.language ? ` (${languageName(cv.language)})` : ""}
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
