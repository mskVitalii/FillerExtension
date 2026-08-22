import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm outline-none",
        "placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
