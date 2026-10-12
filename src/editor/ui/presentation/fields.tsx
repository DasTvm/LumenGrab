import { useState, type ReactNode } from "react";
import { cn } from "@/ui/lib/utils";
import { ColorPicker } from "../ColorPicker";

/** A colour as `#RRGGBB` (the alpha of a stop is not edited here). */
const six = (hex: string) => hex.slice(0, 7).toUpperCase();

/** A small coloured square that opens the colour picker below it. */
export function ColorChip({
  label,
  value,
  onChange,
  onStart,
  onEnd,
  size = "size-9",
  children,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  onStart?: () => void;
  onEnd?: () => void;
  size?: string;
  /** More controls shown beside the chip (they sit inside the same positioned box as the picker). */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex items-center gap-2">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className={cn("shrink-0 rounded-md border border-black/10", size)}
        style={{ background: value }}
        onClick={() => {
          setOpen(!open);
        }}
      />
      {children}
      {open ? (
        <div className="absolute top-full left-0 z-20 mt-1">
          <ColorPicker
            value={six(value)}
            onChange={onChange}
            {...(onStart ? { onStart } : {})}
            {...(onEnd ? { onEnd } : {})}
            onClose={() => {
              setOpen(false);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** A text field for `#RRGGBB`: committed on Enter or when it loses focus; anything else goes back. */
export function HexInput({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}) {
  return (
    <input
      aria-label={label}
      key={value}
      defaultValue={six(value)}
      spellCheck={false}
      className={cn(
        "h-9 min-w-0 rounded-md border border-border bg-background px-3 text-[13px] tabular-nums uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        const typed = e.currentTarget.value.trim().replace(/^#?/, "#");
        if (/^#[0-9a-fA-F]{6}$/.test(typed)) {
          if (typed.toUpperCase() !== six(value)) onChange(typed.toUpperCase());
        } else e.currentTarget.value = six(value);
      }}
    />
  );
}

/** A number field with a prefix and a suffix (`at [60] %`, `T [64]`): committed on Enter or blur, clamped. */
export function NumberInput({
  label,
  value,
  min,
  max,
  prefix,
  suffix,
  onChange,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  prefix?: string;
  suffix?: string;
  onChange: (value: number) => void;
  className?: string;
}) {
  return (
    <label
      className={cn(
        "flex h-9 min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[13px] focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
    >
      {prefix ? (
        <span aria-hidden className="text-muted-foreground">
          {prefix}
        </span>
      ) : null}
      <input
        aria-label={label}
        inputMode="decimal"
        key={value}
        defaultValue={value}
        className="min-w-0 flex-1 bg-transparent text-right tabular-nums outline-none"
        onFocus={(e) => {
          e.currentTarget.select();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const typed = Number(e.currentTarget.value.replace(",", "."));
          const next =
            Number.isFinite(typed) && e.currentTarget.value.trim() !== ""
              ? Math.max(min, Math.min(max, Math.round(typed)))
              : value;
          e.currentTarget.value = String(next);
          if (next !== value) onChange(next);
        }}
      />
      {suffix ? (
        <span aria-hidden className="text-muted-foreground">
          {suffix}
        </span>
      ) : null}
    </label>
  );
}

/** A label with a slider and its value (design: Slider rows: "Blur ... 40px"). */
export function SliderRow({
  label,
  value,
  text,
  children,
}: {
  label: string;
  value?: string;
  text?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums" aria-hidden={text ? undefined : true}>
          {value ?? text}
        </span>
      </div>
      {children}
    </div>
  );
}
