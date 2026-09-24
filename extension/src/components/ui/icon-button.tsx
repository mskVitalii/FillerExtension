import * as React from "react";
import { cn } from "@/lib/utils";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Shown as a hover/focus tooltip and used as the accessible name. */
  label: string;
}

/**
 * Header navigation icon: a fixed 28px hit target that gets a filled
 * background, darker icon and a small label tooltip on hover/focus, so it
 * reads as clickable without taking more header width than the bare icon.
 */
export function IconButton({ label, className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "group relative flex h-7 w-7 items-center justify-center rounded-md text-foreground/60 transition-colors",
        "hover:bg-muted hover:text-foreground active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        "[&_svg]:h-4 [&_svg]:w-4 [&_svg]:transition-transform hover:[&_svg]:scale-110",
        className,
      )}
      {...props}
    >
      {children}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute right-0 top-full z-20 mt-1 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5",
          "text-[10px] font-medium text-background opacity-0 shadow transition-opacity delay-0",
          "group-hover:opacity-100 group-hover:delay-300 group-focus-visible:opacity-100",
        )}
      >
        {label}
      </span>
    </button>
  );
}
