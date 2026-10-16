import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Blend,
  CircleDot,
  Circle,
  Code,
  Droplet,
  Film,
  Grid2x2,
  Grid3x3,
  Hexagon,
  Layers,
  Radio,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Split,
  Square,
  Star,
  Sun,
  Waves,
  Wind,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/ui/lib/utils";
import { kindById } from "@/shader/kinds";
import { layerColors } from "@/shader/scene";
import type { ShaderLayer, ShaderScene } from "@/shader/types";

export const KIND_ICONS: Record<string, LucideIcon> = {
  gradient: Blend,
  orbs: CircleDot,
  aurora: Sparkles,
  waves: Waves,
  liquid: Droplet,
  cells: Hexagon,
  ripples: Radio,
  pattern: Grid3x3,
  rays: Sun,
  stars: Star,
  solid: Square,
  warp: Wind,
  swirl: RotateCw,
  chromatic: Split,
  pixelate: Grid2x2,
  posterize: Layers,
  vignette: Circle,
  grain: Film,
  glow: Sun,
  grade: SlidersHorizontal,
  custom: Code,
};

/** The small coloured square of a layer: its colours for a generator, an icon for an effect. */
export function KindChip({
  layer,
  scene,
  size = 20,
}: {
  layer: ShaderLayer;
  scene: ShaderScene;
  size?: number;
}) {
  const kind = kindById(layer.kind);
  const Icon = KIND_ICONS[layer.kind] ?? Code;
  const effect = (layer.kind === "custom" ? layer.role : kind?.role) === "effect";
  const colors = kind ? layerColors(scene, layer, kind) : [];
  const background =
    !effect && colors.length >= 2
      ? `linear-gradient(135deg, ${colors[0] ?? "#888"}, ${colors[Math.min(1, colors.length - 1)] ?? "#444"})`
      : !effect && layer.kind === "custom"
        ? "linear-gradient(135deg, #18181B, #3F3F46)"
        : undefined;
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[6px]",
        background ? "text-white" : "bg-muted text-muted-foreground",
        layer.kind === "custom" && "text-[#C8FF2E]",
      )}
      style={{ width: size, height: size, background }}
    >
      <Icon className="size-[55%]" />
    </span>
  );
}

/** A box that opens below a button and closes on Esc or a click outside. */
export function Popover({
  open,
  onClose,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const parent = root.current?.parentElement;
      if (parent && !parent.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={root}
      className={cn(
        "absolute z-50 flex flex-col rounded-lg border border-border bg-card p-1 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.18)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function MenuItem({
  icon,
  label,
  hint,
  onClick,
  danger,
  active,
  role = "menuitem",
}: {
  icon?: ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  role?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left hover:bg-muted",
        danger && "text-destructive",
        active && "bg-muted",
      )}
      onClick={onClick}
    >
      {icon}
      <span className="flex-1 truncate">{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <span className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
      {children}
    </span>
  );
}

/** A number with decimals in a small box: committed on Enter or blur, clamped, stepped with the arrow keys. */
export function DecimalBox({
  label,
  value,
  min,
  max,
  step,
  decimals,
  unit,
  prefix,
  signed,
  scale = 1,
  onChange,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  unit?: string;
  prefix?: string;
  signed?: boolean;
  /** The shown number is `value x scale` (a percentage shows 0 to 100 for 0 to 1). */
  scale?: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const shown = (v: number) => {
    const n = (v * scale).toFixed(decimals);
    return signed && v > 0 ? `+${n}` : n;
  };
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    const typed = Number(text.replace(",", ".").replace("+", ""));
    if (!Number.isFinite(typed) || text.trim() === "") return;
    const next = clamp(typed / scale);
    if (next !== value) onChange(next);
  };
  return (
    <label
      className={cn(
        "flex h-7 min-w-0 items-center rounded-md bg-muted px-2 text-xs focus-within:ring-2 focus-within:ring-ring",
        unit === "%" ? "gap-0" : "gap-1",
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
        value={draft ?? shown(value)}
        className="min-w-0 flex-1 bg-transparent text-right tabular-nums outline-none"
        onFocus={(e) => {
          setDraft(shown(value).replace("+", ""));
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const next = clamp(value + (e.key === "ArrowUp" ? step : -step));
            setDraft(null);
            onChange(Math.round(next / step) * step);
          }
        }}
        onBlur={(e) => {
          if (draft !== null) commit(e.currentTarget.value);
        }}
      />
      {unit ? (
        <span aria-hidden className="text-muted-foreground">
          {unit}
        </span>
      ) : null}
    </label>
  );
}

/** Minus, a whole number and plus in a compact box (the Speed of a layer). */
export function MiniStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const set = (v: number) => {
    onChange(Math.min(max, Math.max(min, Math.round(v))));
  };
  return (
    <div
      role="group"
      aria-label={label}
      className="flex h-8 items-center rounded-lg border border-border bg-background"
    >
      <button
        type="button"
        aria-label={`${label}: slower`}
        disabled={value <= min}
        className="flex size-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
        onClick={() => {
          set(value - 1);
        }}
      >
        <span aria-hidden>−</span>
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        key={value}
        defaultValue={value}
        className="w-7 bg-transparent text-center text-[13px] tabular-nums outline-none"
        onFocus={(e) => {
          e.currentTarget.select();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const typed = Number(e.currentTarget.value);
          if (Number.isFinite(typed) && e.currentTarget.value.trim() !== "") set(typed);
          else e.currentTarget.value = String(value);
        }}
      />
      <button
        type="button"
        aria-label={`${label}: faster`}
        disabled={value >= max}
        className="flex size-7 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
        onClick={() => {
          set(value + 1);
        }}
      >
        <span aria-hidden>+</span>
      </button>
    </div>
  );
}
