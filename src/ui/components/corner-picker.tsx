import { cn } from "@/ui/lib/utils";

export type PickerCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";

const CORNERS: readonly { value: PickerCorner; label: string; position: string }[] = [
  { value: "topLeft", label: "Top left", position: "left-2 top-2" },
  { value: "topRight", label: "Top right", position: "right-2 top-2" },
  { value: "bottomLeft", label: "Bottom left", position: "bottom-2 left-2" },
  { value: "bottomRight", label: "Bottom right", position: "bottom-2 right-2" },
];

interface CornerPickerProps {
  value: PickerCorner;
  onValueChange: (value: PickerCorner) => void;
  label: string;
  disabled?: boolean;
}

/** Design system: Corner Picker (Settings > After capture). A radio group of the four screen corners. */
export function CornerPicker({ value, onValueChange, label, disabled }: CornerPickerProps) {
  const move = (from: PickerCorner, key: string): PickerCorner | null => {
    const top = from.startsWith("top");
    const left = from.endsWith("Left");
    if (key === "ArrowRight") return top ? "topRight" : "bottomRight";
    if (key === "ArrowLeft") return top ? "topLeft" : "bottomLeft";
    if (key === "ArrowDown") return left ? "bottomLeft" : "bottomRight";
    if (key === "ArrowUp") return left ? "topLeft" : "topRight";
    return null;
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled}
      className={cn(
        "relative h-14 w-[84px] shrink-0 rounded-md border border-border bg-secondary",
        disabled && "pointer-events-none opacity-50",
      )}
    >
      {CORNERS.map((c) => {
        const selected = c.value === value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c.label}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              onValueChange(c.value);
            }}
            onKeyDown={(e) => {
              const next = move(value, e.key);
              if (next) {
                e.preventDefault();
                onValueChange(next);
                e.currentTarget.parentElement
                  ?.querySelector<HTMLElement>(
                    `[aria-label="${CORNERS.find((x) => x.value === next)?.label ?? ""}"]`,
                  )
                  ?.focus();
              }
            }}
            className={cn(
              "absolute size-2.5 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-secondary",
              c.position,
              selected ? "border-[1.5px] border-foreground bg-brand" : "bg-border",
            )}
          />
        );
      })}
    </div>
  );
}
