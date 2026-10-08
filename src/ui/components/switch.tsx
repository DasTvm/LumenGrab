import type { ComponentProps } from "react";
import { cn } from "@/ui/lib/utils";

interface SwitchProps extends Omit<ComponentProps<"button">, "onChange" | "role" | "type"> {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

/** Design system: Switch/On (lime track, dark knob) and Switch/Off (border track, light knob). */
export function Switch({ checked, onCheckedChange, className, disabled, ...props }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "relative h-5 w-9 shrink-0 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50",
        checked ? "bg-brand" : "bg-border",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 size-4 rounded-full transition-[left]",
          checked ? "left-[18px] bg-primary" : "left-0.5 bg-background",
        )}
      />
    </button>
  );
}
