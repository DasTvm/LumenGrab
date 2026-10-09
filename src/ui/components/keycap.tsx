import { cn } from "@/ui/lib/utils";

/** Settings > Hotkeys: one key of a shortcut. */
export function Keycap({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-7 min-w-7 items-center justify-center px-1.5 rounded-sm border border-border bg-muted font-sans text-xs font-semibold text-foreground",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
