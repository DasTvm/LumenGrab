import { useRef, type ReactNode } from "react";
import { Minus, Plus, Slash } from "lucide-react";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";

/** A labelled group of controls with the current value on the right (design: "Section Header"). */
export function Section({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-medium">{label}</h3>
        {value ? <span className="text-xs text-muted-foreground tabular-nums">{value}</span> : null}
      </div>
      {children}
    </section>
  );
}

interface SwatchRowProps {
  label: string;
  value: string | null;
  colors: readonly string[];
  onChange: (color: string | null) => void;
  /** Offer a "None" swatch first (a fill or a background can be off). */
  none?: boolean;
}

const sameColor = (a: string | null, b: string | null) =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/** The swatch row: optionally None, the palette of the design, and a custom colour (the "+"). */
export function SwatchRow({ label, value, colors, onChange, none }: SwatchRowProps) {
  const input = useRef<HTMLInputElement>(null);
  const custom = value !== null && !colors.some((c) => sameColor(c, value));
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {none ? (
        <button
          type="button"
          role="radio"
          aria-checked={value === null}
          aria-label={`${label}: none`}
          className={cn(
            "flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground",
            value === null && "ring-2 ring-primary ring-offset-1 ring-offset-card",
          )}
          onClick={() => {
            onChange(null);
          }}
        >
          <Slash aria-hidden className="size-4" />
        </button>
      ) : null}
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={sameColor(value, color)}
          aria-label={`${label}: ${color}`}
          title={color}
          className={cn(
            "size-7 rounded-md border border-black/10",
            sameColor(value, color) && "ring-2 ring-primary ring-offset-1 ring-offset-card",
          )}
          style={{ background: color }}
          onClick={() => {
            onChange(color.toUpperCase());
          }}
        />
      ))}
      <button
        type="button"
        role="radio"
        aria-checked={custom}
        aria-label={`${label}: custom colour`}
        title="Custom colour"
        className={cn(
          "flex size-7 items-center justify-center rounded-md border border-black/10 text-white",
          custom && "ring-2 ring-primary ring-offset-1 ring-offset-card",
        )}
        style={{
          background:
            custom && value
              ? value
              : "conic-gradient(from 0deg, #ef4444, #facc15, #16a34a, #2563eb, #c026d3, #ef4444)",
        }}
        onClick={() => {
          input.current?.click();
        }}
      >
        <Plus aria-hidden className="size-3.5 drop-shadow" />
      </button>
      <input
        ref={input}
        type="color"
        aria-label={`${label}: pick a colour`}
        tabIndex={-1}
        className="pointer-events-none absolute size-0 opacity-0"
        value={(value ?? "#000000").slice(0, 7)}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
        }}
      />
    </div>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** A drag on the slider is one undo step: these frame it. */
  onStart?: () => void;
  onEnd?: () => void;
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  onStart,
  onEnd,
}: SliderProps) {
  const fill = `${String(Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100)))}%`;
  return (
    <input
      type="range"
      aria-label={label}
      className="lg-slider"
      style={{ "--lg-fill": fill } as React.CSSProperties}
      min={min}
      max={max}
      step={step}
      value={value}
      onPointerDown={onStart}
      onPointerUp={onEnd}
      onPointerCancel={onEnd}
      onChange={(e) => {
        onChange(Number(e.target.value));
      }}
    />
  );
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (value: number) => void;
}

/** Minus, the value and plus (design: Text > Size). */
export function Stepper({ label, value, min, max, step = 1, unit = "px", onChange }: StepperProps) {
  const set = (next: number) => {
    onChange(Math.max(min, Math.min(max, next)));
  };
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-9 items-center rounded-md border border-border bg-background"
    >
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`${label}: smaller`}
        disabled={value <= min}
        onClick={() => {
          set(value - step);
        }}
      >
        <Minus aria-hidden />
      </Button>
      <span className="flex-1 text-center text-[13px] tabular-nums" aria-live="polite">
        {`${String(value)} ${unit}`}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="size-8"
        aria-label={`${label}: larger`}
        disabled={value >= max}
        onClick={() => {
          set(value + step);
        }}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  );
}

interface PillOption<T extends string> {
  value: T;
  label: string;
  icon?: ReactNode;
  /** Icon-only option: the label is only the accessible name. */
  iconOnly?: boolean;
}

/** The full-width pill group of the design (Font, Weight, Align, Mode, Shape): one option is the white one. */
export function Pills<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly PillOption<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-md bg-muted p-1">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.iconOnly ? o.label : undefined}
            className={cn(
              "flex h-6.5 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-sm px-2 text-[13px] font-medium",
              selected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              onChange(o.value);
            }}
          >
            {o.icon}
            {o.iconOnly ? null : <span className="truncate">{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
