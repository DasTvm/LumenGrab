import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
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
/** How far a menu keeps from the edge of the window. */
const EDGE = 8;
/** The gap between the button and its menu. */
const GAP = 6;

/** Where a menu of `width` x `height` goes for a button at `anchor`: below or above it, kept inside the window. */
export function placeMenu(
  anchor: { left: number; right: number; top: number; bottom: number },
  menu: { width: number; height: number },
  view: { width: number; height: number },
  prefer: { side: "below" | "above"; align: "start" | "end" },
): { left: number; top: number; maxHeight: number } {
  const roomBelow = view.height - anchor.bottom - GAP - EDGE;
  const roomAbove = anchor.top - GAP - EDGE;
  const needed = menu.height;
  // The wanted side, unless the menu does not fit there and the other side has more room.
  const wanted = prefer.side === "below" ? roomBelow : roomAbove;
  const other = prefer.side === "below" ? roomAbove : roomBelow;
  const side =
    wanted >= needed || wanted >= other ? prefer.side : prefer.side === "below" ? "above" : "below";
  const room = Math.max(80, side === "below" ? roomBelow : roomAbove);
  const height = Math.min(needed, room);
  const top = side === "below" ? anchor.bottom + GAP : anchor.top - GAP - height;
  const wantedLeft = prefer.align === "end" ? anchor.right - menu.width : anchor.left;
  const left = Math.min(Math.max(wantedLeft, EDGE), Math.max(EDGE, view.width - menu.width - EDGE));
  return { left, top: Math.max(EDGE, top), maxHeight: room };
}

/**
 * A small menu that belongs to the button it sits in (its parent). It is drawn on top of everything, in
 * its own layer, so no scroll area or clipped panel can cut it off, and it is placed next to the button:
 * below it (or above where there is no room), flush with its right or left edge, always inside the window.
 */
export function Popover({
  open,
  onClose,
  children,
  className,
  side = "below",
  align = "end",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Size and scrolling only (`w-[168px]`, `max-h-[560px] overflow-y-auto`); the place is worked out. */
  className?: string;
  /** Which side of the button it prefers. */
  side?: "below" | "above";
  /** Which edge of the button it lines up with. */
  align?: "start" | "end";
}) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number; maxHeight: number } | null>(null);

  // The anchor is a marker in the button's container; the button is that container.
  const anchorBox = () => anchorRef.current?.parentElement?.getBoundingClientRect() ?? null;

  const measure = () => {
    const anchor = anchorBox();
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    // Measure at the natural height: a menu that was cut earlier may be taller now.
    const natural = menu.scrollHeight + 2;
    setPlace(
      placeMenu(
        anchor,
        { width: menu.offsetWidth, height: natural },
        { width: window.innerWidth, height: window.innerHeight },
        { side, align },
      ),
    );
  };

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- measures what is there when it opens
  }, [open, side, align]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      const target = e.target as Node;
      const parent = anchorRef.current?.parentElement;
      if (parent?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    };
    // A scrolled list or a resized window moves the button: the menu follows it.
    const follow = () => {
      measure();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `measure` only reads refs and props
  }, [open, onClose, side, align]);

  return (
    <>
      <span ref={anchorRef} aria-hidden hidden />
      {open
        ? createPortal(
            <div
              ref={menuRef}
              data-popover
              className={cn(
                "fixed z-[60] flex flex-col overflow-y-auto rounded-lg border border-border bg-card p-1 text-[13px] text-card-foreground shadow-[0_8px_24px_rgb(0_0_0/0.18)]",
                className,
              )}
              style={
                place
                  ? { left: place.left, top: place.top, maxHeight: place.maxHeight }
                  : { left: 0, top: 0, visibility: "hidden" }
              }
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
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
