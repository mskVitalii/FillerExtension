import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The FAQ editor drawn as a messenger thread: the interviewer's question on
 * the left, the applicant's answer on the right. Answer bubbles are
 * textareas that grow with their text (`field-sizing: content`).
 */

const GROW = "w-full resize-none bg-transparent outline-none [field-sizing:content]";

/** "About you" — a centered chip between groups, like a date separator in a chat. */
export function FaqChatDivider({ children }: { children: ReactNode }) {
  return (
    <div className="my-1 flex justify-center">
      <span className="rounded-full bg-muted px-3 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

/** Left bubble. Editable (with a delete button) for the user's own questions. */
export function FaqQuestionBubble({
  question,
  placeholder,
  onChange,
  onDelete,
  deleteLabel,
}: {
  question: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  return (
    <div className="flex items-start gap-1">
      <div className="max-w-[80%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm font-medium">
        {onChange ? (
          <textarea
            rows={1}
            className={cn(GROW, "min-w-[12rem] placeholder:text-muted-foreground")}
            value={question}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          question
        )}
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={deleteLabel}
          title={deleteLabel}
          className="mt-1.5 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/** Right bubble: the applicant's answer, edited in place. An empty one is dashed, waiting to be written or generated. */
export function FaqAnswerBubble({
  answer,
  placeholder,
  label,
  onChange,
}: {
  answer: string;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
}) {
  const empty = !answer.trim();
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-primary/30",
          empty ? "border border-dashed border-border bg-background" : "bg-primary text-primary-foreground",
        )}
      >
        <textarea
          rows={2}
          aria-label={label}
          className={cn(GROW, "max-h-80 leading-snug", empty ? "placeholder:text-muted-foreground" : "placeholder:text-primary-foreground/60")}
          value={answer}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
