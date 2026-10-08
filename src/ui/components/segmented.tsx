import { cn } from "@/ui/lib/utils";

interface SegmentedProps<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onValueChange: (value: T) => void;
  /** `brand`: lime selection (design: Tabs). `neutral`: white selection (design: Settings theme picker). */
  tone?: "brand" | "neutral";
  label: string;
  className?: string;
}

/** Design system: Tabs / Segmented. A radio group: arrow keys move, the selected option is tabbable. */
export function Segmented<T extends string>({
  value,
  options,
  onValueChange,
  tone = "brand",
  label,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex gap-1 rounded-md bg-muted p-1", className)}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              onValueChange(o.value);
            }}
            onKeyDown={(e) => {
              const i = options.findIndex((x) => x.value === value);
              const step =
                e.key === "ArrowRight" || e.key === "ArrowDown"
                  ? 1
                  : e.key === "ArrowLeft" || e.key === "ArrowUp"
                    ? -1
                    : 0;
              const next = options[(i + step + options.length) % options.length];
              if (step !== 0 && next) {
                e.preventDefault();
                onValueChange(next.value);
                (
                  e.currentTarget.parentElement?.querySelectorAll("button")[
                    options.indexOf(next)
                  ] as HTMLElement | undefined
                )?.focus();
              }
            }}
            className={cn(
              "rounded-sm px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selected
                ? tone === "brand"
                  ? "bg-brand text-foreground"
                  : "bg-background text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
