import { cn } from "@/ui/lib/utils";

/** Settings > Hotkeys: one key of a shortcut. */
export function Keycap({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-sm border border-border bg-muted font-sans text-xs font-semibold text-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
