import type { ReactNode } from "react";
import { cn } from "@/ui/lib/utils";

interface TooltipProps {
  /** The name shown in the bubble. */
  label: string;
  /** The shortcut, shown as a small key next to the name. */
  shortcut?: string;
  /** Where the bubble opens. */
  side?: "right" | "bottom" | "top";
  children: ReactNode;
  className?: string;
}

const SIDE = {
  right: "left-full top-1/2 ml-2 -translate-y-1/2",
  bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
  top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
} as const;

/**
 * A hover and focus tooltip (design: tool rail hover). Pure CSS: the bubble appears after a short
 * delay and never takes the pointer. The trigger keeps its own accessible name (`aria-label`);
 * the bubble is only a visual extra.
 */
export function Tooltip({ label, shortcut, side = "right", children, className }: TooltipProps) {
  return (
    <span className={cn("group/tip relative inline-flex", className)}>
      {children}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute z-50 flex items-center gap-2 rounded-md bg-primary px-2 py-1 text-xs font-medium whitespace-nowrap text-primary-foreground opacity-0 transition-opacity delay-0 group-focus-within/tip:opacity-100 group-hover/tip:opacity-100 group-hover/tip:delay-500",
          SIDE[side],
        )}
      >
        {label}
        {shortcut ? (
          <kbd className="rounded bg-primary-foreground/20 px-1 font-sans text-[11px]">
            {shortcut}
          </kbd>
        ) : null}
      </span>
    </span>
  );
}
