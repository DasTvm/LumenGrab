import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/ui/lib/utils";

/** Design system: Input Group (label above, bordered field). */
export function Field({
  label,
  className,
  ...props
}: { label: ReactNode } & ComponentProps<"input">) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <input
        id={id}
        className={cn(
          "rounded-md border border-border bg-background px-3 py-2 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        {...props}
      />
    </div>
  );
}
