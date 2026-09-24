import { Sparkles } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { CvVariable } from "@/types/cv-template";

const CUSTOM = "__custom__";

/** A multi-line option (a swappable block) is labelled by its first line. */
function optionLabel(option: string): string {
  const [first, ...rest] = option.split("\n");
  const label = first.trim() || "(empty)";
  return rest.some((line) => line.trim()) ? `${label} …` : label;
}

interface VariableSelectorProps {
  variable: CvVariable;
  value: string;
  /** Options that literally occur in the posting (see `findOptionsInPosting`) — listed first. */
  foundInPosting: string[];
  /** Forced into the free-text editor even though `value` equals an option (the user picked "Custom…"). */
  custom: boolean;
  reason?: string;
  onChange: (value: string, custom: boolean) => void;
}

/**
 * One `{{placeholder}}`'s value for the current posting: a selector over its
 * predefined variants (the ones found in the posting grouped first), plus
 * "Custom…" for a one-off value typed by hand.
 */
export function VariableSelector({ variable, value, foundInPosting, custom, reason, onChange }: VariableSelectorProps) {
  const optionIndex = variable.options.indexOf(value);
  const isCustom = custom || optionIndex === -1;
  const selectValue = isCustom ? CUSTOM : `o:${optionIndex}`;
  const found = new Set(foundInPosting);
  const indexed = variable.options.map((option, index) => ({ option, index }));
  const foundOptions = foundInPosting
    .map((option) => indexed.find((entry) => entry.option === option))
    .filter((entry): entry is { option: string; index: number } => Boolean(entry));
  const otherOptions = indexed.filter((entry) => !found.has(entry.option));
  const multiline = value.includes("\n") || variable.options.some((option) => option.includes("\n"));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`cv-var-${variable.name}`} className="font-mono text-xs font-medium">
          {`{{${variable.name}}}`}
        </label>
        {foundOptions.length > 0 && (
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {foundOptions.length} found in posting
          </span>
        )}
      </div>
      {variable.description && <p className="text-xs text-muted-foreground">{variable.description}</p>}
      {variable.options.length > 0 && (
        <Select
          id={`cv-var-${variable.name}`}
          value={selectValue}
          onChange={(e) => {
            const next = e.target.value;
            if (next === CUSTOM) onChange(value, true);
            else onChange(variable.options[Number(next.slice(2))], false);
          }}
        >
          {foundOptions.length > 0 && (
            <optgroup label="In this posting">
              {foundOptions.map(({ option, index }) => (
                <option key={index} value={`o:${index}`}>
                  {optionLabel(option)}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label={foundOptions.length > 0 ? "Other variants" : "Variants"}>
            {otherOptions.map(({ option, index }) => (
              <option key={index} value={`o:${index}`}>
                {optionLabel(option)}
              </option>
            ))}
          </optgroup>
          <option value={CUSTOM}>Custom…</option>
        </Select>
      )}
      {(isCustom || variable.options.length === 0) &&
        (multiline ? (
          <textarea
            id={variable.options.length === 0 ? `cv-var-${variable.name}` : undefined}
            className="min-h-20 rounded-md border border-border bg-background p-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary"
            value={value}
            onChange={(e) => onChange(e.target.value, true)}
          />
        ) : (
          <input
            id={variable.options.length === 0 ? `cv-var-${variable.name}` : undefined}
            className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-primary"
            value={value}
            placeholder="Value for this posting"
            onChange={(e) => onChange(e.target.value, true)}
          />
        ))}
      {reason && (
        <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
          <Sparkles className="mt-0.5 h-3 w-3 shrink-0" /> {reason}
        </p>
      )}
    </div>
  );
}
