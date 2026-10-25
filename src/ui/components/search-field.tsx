import type { ComponentProps } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/ui/lib/utils";

/** A search box with a magnifier and a clear button (design: History toolbar). */
export function SearchField({
  value,
  onValueChange,
  label,
  className,
  ...rest
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
  label: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-background px-3 py-[7px] focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
    >
      <Search className="size-[15px] shrink-0 text-muted-foreground" aria-hidden />
      <input
        {...rest}
        type="text"
        role="searchbox"
        aria-label={label}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            e.stopPropagation();
            onValueChange("");
          }
          rest.onKeyDown?.(e);
        }}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            onValueChange("");
          }}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
