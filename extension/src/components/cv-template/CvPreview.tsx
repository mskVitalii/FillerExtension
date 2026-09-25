import type { CvBlock } from "@/features/cv-template/preview";
import { cn } from "@/lib/utils";

/**
 * The CV's text with every substituted `{{placeholder}}` value highlighted —
 * exact about content, not about layout (Preview PDF shows the real page).
 */
export function CvPreview({ blocks }: { blocks: CvBlock[] }) {
  if (blocks.length === 0) {
    return <p className="text-xs text-muted-foreground">No text found in this CV.</p>;
  }
  return (
    <div className="flex flex-col text-[11px] leading-snug">
      {blocks.map((block, index) =>
        block.type === "gap" ? (
          <div key={index} className="h-1.5" />
        ) : (
          <p key={index}>
            {block.spans.map((span, i) => (
              <span key={i} className={cn(span.mark && "rounded-sm bg-amber-100 text-amber-950")}>
                {span.text}
              </span>
            ))}
          </p>
        ),
      )}
    </div>
  );
}
