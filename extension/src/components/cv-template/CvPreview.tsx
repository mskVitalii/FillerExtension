import type { CvBlock, CvSpan } from "@/features/cv-template/markdown";
import { cn } from "@/lib/utils";

function Spans({ spans }: { spans: CvSpan[] }) {
  return (
    <>
      {spans.map((span, i) => {
        const className = cn(
          span.bold && "font-semibold",
          span.italic && "italic",
          span.mark && "rounded-sm bg-amber-100 text-amber-950",
          span.link && "text-primary underline underline-offset-2",
        );
        return span.link ? (
          <a key={i} href={span.link} target="_blank" rel="noreferrer" className={className}>
            {span.text}
          </a>
        ) : (
          <span key={i} className={className}>
            {span.text}
          </span>
        );
      })}
    </>
  );
}

function Line({ left, right, className }: { left: CvSpan[]; right: CvSpan[] | null; className?: string }) {
  if (!right) {
    return (
      <p className={className}>
        <Spans spans={left} />
      </p>
    );
  }
  return (
    <div className={cn("flex justify-between gap-3", className)}>
      <p className="min-w-0">
        <Spans spans={left} />
      </p>
      <p className="shrink-0 font-normal text-muted-foreground">
        <Spans spans={right} />
      </p>
    </div>
  );
}

/**
 * HTML twin of `features/pdf/CvDocument.tsx`, driven by the same parsed
 * blocks — an approximation of the page layout, but exact about content,
 * with every substituted `{{placeholder}}` value highlighted.
 */
export function CvPreview({ blocks }: { blocks: CvBlock[] }) {
  if (blocks.length === 0) {
    return <p className="text-xs text-muted-foreground">The template is empty.</p>;
  }
  return (
    <div className="flex flex-col text-[11px] leading-snug">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "gap":
            return <div key={index} className="h-1.5" />;
          case "rule":
            return <hr key={index} className="my-1.5 border-border" />;
          case "heading":
            return (
              <Line
                key={index}
                left={block.left}
                right={block.right}
                className={cn(
                  block.level === 1 && "text-base font-bold",
                  block.level === 2 &&
                    "mb-1 mt-2 border-b border-border pb-0.5 text-[11.5px] font-bold uppercase tracking-wide text-primary",
                  block.level === 3 && "mt-1 font-semibold",
                )}
              />
            );
          case "bullet":
            return (
              <div key={index} className="flex gap-1.5" style={{ paddingLeft: block.depth * 12 }}>
                <span aria-hidden>{block.depth > 0 ? "–" : "•"}</span>
                <Line left={block.left} right={block.right} className="min-w-0 flex-1" />
              </div>
            );
          case "line":
            return <Line key={index} left={block.left} right={block.right} />;
        }
      })}
    </div>
  );
}
