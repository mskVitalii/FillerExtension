import { Plus, Trash2, X } from "lucide-react";
import type { CvVariable, CvVariableMode } from "@/types/cv-template";
import { cn } from "@/lib/utils";

const MODE_HINT: Record<CvVariableMode, string> = {
  choice: "Always one of the variants below.",
  free: "Variants are examples — the AI may write its own value in the same shape.",
};

interface VariableEditorProps {
  variable: CvVariable;
  /** False when `{{name}}` no longer appears in the template (kept so a typo doesn't wipe its variants). */
  used: boolean;
  onChange: (variable: CvVariable) => void;
  onDelete: () => void;
}

/** Definition of one `{{placeholder}}`: what it means (the AI's instruction), how it's chosen, and its variants. */
export function VariableEditor({ variable, used, onChange, onDelete }: VariableEditorProps) {
  function setOption(index: number, value: string) {
    onChange({ ...variable, options: variable.options.map((option, i) => (i === index ? value : option)) });
  }

  return (
    <div className={cn("flex flex-col gap-2 rounded-md border border-border p-2", !used && "border-dashed opacity-70")}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-medium">{`{{${variable.name}}}`}</span>
        {!used && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
            not in template
            <button onClick={onDelete} aria-label={`Delete ${variable.name}`} className="rounded p-0.5 hover:bg-muted">
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        )}
      </div>

      <textarea
        className="min-h-12 rounded-md border border-border bg-background p-2 text-xs outline-none focus-visible:ring-1 focus-visible:ring-primary"
        placeholder="What this stands for and how to pick it, e.g. “Main programming language of the role; pick the one the posting emphasizes most.”"
        value={variable.description}
        onChange={(e) => onChange({ ...variable, description: e.target.value })}
      />

      <div className="flex flex-col gap-1">
        <div className="flex w-fit gap-0.5 rounded-md bg-muted p-0.5 text-xs" role="radiogroup" aria-label="Mode">
          {(["choice", "free"] as const).map((mode) => (
            <button
              key={mode}
              role="radio"
              aria-checked={variable.mode === mode}
              onClick={() => onChange({ ...variable, mode })}
              className={cn(
                "rounded px-2 py-0.5",
                variable.mode === mode ? "bg-background font-medium shadow-sm" : "text-muted-foreground",
              )}
            >
              {mode === "choice" ? "Pick a variant" : "Free text"}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">{MODE_HINT[variable.mode]}</p>
      </div>

      <div className="flex flex-col gap-1">
        {variable.options.map((option, index) => (
          <div key={index} className="flex items-start gap-1">
            <textarea
              rows={1}
              className="min-h-8 flex-1 resize-none rounded-md border border-border bg-background px-2 py-1 text-xs outline-none [field-sizing:content] focus-visible:ring-1 focus-visible:ring-primary"
              value={option}
              placeholder="Variant (can span several lines)"
              onChange={(e) => setOption(index, e.target.value)}
            />
            <button
              onClick={() => onChange({ ...variable, options: variable.options.filter((_, i) => i !== index) })}
              aria-label="Remove variant"
              className="mt-1 rounded p-0.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
        <button
          onClick={() => onChange({ ...variable, options: [...variable.options, ""] })}
          className="flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> Add variant
        </button>
      </div>
    </div>
  );
}
