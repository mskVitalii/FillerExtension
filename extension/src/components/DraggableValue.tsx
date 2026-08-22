import type { DragEvent, ReactNode } from "react";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

interface DraggableValueProps {
  value: string;
  children: ReactNode;
  /** Applied to the content wrapper (next to the grip icon), not the icon itself. */
  className?: string;
  /** Called synchronously from `dragstart` to attach extra dataTransfer items (e.g. a file). */
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void;
}

/**
 * Wraps a value so the user can drag it straight out of the Side Panel onto
 * the page — Chrome's native drag-and-drop inserts `text/plain` into any
 * focused input/textarea/contenteditable on drop, so no content-script
 * support is needed for the text case.
 *
 * The grip icon lives outside the `className`-styled content wrapper on
 * purpose: passing e.g. `justify-between` straight to the outer flex row
 * would space the icon, label, and value apart as three equal items
 * instead of pinning the icon and spacing only label/value.
 */
export function DraggableValue({ value, children, className, onDragStart }: DraggableValueProps) {
  const draggable = Boolean(value);

  function handleDragStart(e: DragEvent<HTMLDivElement>) {
    if (!value) return;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", value);
    onDragStart?.(e);
  }

  return (
    <div
      draggable={draggable}
      onDragStart={handleDragStart}
      className={cn("flex items-center gap-1.5", draggable && "cursor-grab active:cursor-grabbing")}
      title={draggable ? "Drag onto the page to insert this value" : undefined}
    >
      {draggable ? (
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <div className={cn("flex min-w-0 flex-1 items-center", className)}>{children}</div>
    </div>
  );
}
