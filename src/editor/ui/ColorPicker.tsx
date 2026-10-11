import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, Pipette, X } from "lucide-react";
import { cn } from "@/ui/lib/utils";
import { hexToHsv, hsvToHex, hueColor, parseHex, type Hsv } from "./color-math";
import { removeSavedColor, saveColor, useSavedColors } from "./saved-colors";

interface Props {
  /** The current colour, `#RRGGBB`. */
  value: string;
  onChange: (hex: string) => void;
  /** Dragging in the picker is one undo step: these frame it. */
  onStart?: () => void;
  onEnd?: () => void;
  onClose: () => void;
}

interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>;
}
const eyeDropper = (): (new () => EyeDropperLike) | null =>
  "EyeDropper" in window
    ? (window as unknown as { EyeDropper: new () => EyeDropperLike }).EyeDropper
    : null;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * LumenGrab's own colour picker (the system one differs per OS and is missing in the macOS WebView): a
 * saturation / brightness square, a hue slider, a hex field, the eyedropper where the engine has one, and
 * the user's saved colours. Opaque colours only, like every colour in the panels.
 */
export function ColorPicker({ value, onChange, onStart, onEnd, onClose }: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [text, setText] = useState(value);
  const saved = useSavedColors();
  const root = useRef<HTMLDivElement>(null);
  const square = useRef<HTMLDivElement>(null);
  const dropper = eyeDropper();

  // A change from outside (a swatch was clicked, undo) moves the picker; its own changes do not bounce back.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (hsvToHex(hsv) !== value.toUpperCase()) {
      setHsv(hexToHsv(value));
      setText(value.toUpperCase());
    }
  }

  // Esc and a press outside close it.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.parentElement?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, []);

  const set = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    setText(hex);
    onChange(hex);
  };

  const fromPointer = (e: React.PointerEvent) => {
    const box = square.current?.getBoundingClientRect();
    if (!box) return;
    set({
      h: hsv.h,
      s: clamp01((e.clientX - box.left) / box.width),
      v: 1 - clamp01((e.clientY - box.top) / box.height),
    });
  };

  const current = hsvToHex(hsv);
  const isSaved = saved.includes(current);

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Colour picker"
      data-testid="color-picker"
      className="absolute inset-x-0 top-full z-30 mt-2 flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-[0_8px_24px_rgb(0_0_0/0.25)]"
    >
      <div
        ref={square}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${String(Math.round(hsv.s * 100))} %, brightness ${String(Math.round(hsv.v * 100))} %`}
        data-testid="color-square"
        className="relative h-36 cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{
          background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueColor(hsv.h)}`,
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onStart?.();
          fromPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          onEnd?.();
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.01;
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, step],
            ArrowDown: [0, -step],
          };
          const move = moves[e.key];
          if (!move) return;
          e.preventDefault();
          set({ h: hsv.h, s: clamp01(hsv.s + move[0]), v: clamp01(hsv.v + move[1]) });
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)]"
          style={{
            left: `${String(hsv.s * 100)}%`,
            top: `${String((1 - hsv.v) * 100)}%`,
            background: current,
          }}
        />
      </div>

      <input
        type="range"
        aria-label="Hue"
        className="lg-hue"
        min={0}
        max={359}
        value={Math.round(hsv.h)}
        onPointerDown={onStart}
        onPointerUp={onEnd}
        onChange={(e) => {
          set({ ...hsv, h: Number(e.target.value) });
        }}
      />

      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="size-8 shrink-0 rounded-md border border-black/10"
          style={{ background: current }}
        />
        <input
          aria-label="Hex colour"
          value={text}
          spellCheck={false}
          maxLength={9}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-[13px] uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(e) => {
            setText(e.target.value);
            const hex = parseHex(e.target.value);
            if (hex) {
              setHsv(hexToHsv(hex));
              onChange(hex);
            }
          }}
          onBlur={() => {
            setText(current);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        {dropper ? (
          <button
            type="button"
            aria-label="Pick a colour from the screen"
            title="Pick a colour from the screen"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted"
            onClick={() => {
              new dropper().open().then(
                (result) => {
                  const hex = parseHex(result.sRGBHex);
                  if (hex) set(hexToHsv(hex));
                },
                () => undefined, // cancelled with Esc
              );
            }}
          >
            <Pipette aria-hidden className="size-4" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={isSaved ? "Colour is saved" : "Save this colour"}
          title={isSaved ? "Already in your saved colours" : "Save this colour"}
          disabled={isSaved}
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
          onClick={() => {
            saveColor(current);
          }}
        >
          <BookmarkPlus aria-hidden className="size-4" />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Saved colours</span>
        {saved.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Colours you save stay here for every picture.
          </p>
        ) : (
          <ul aria-label="Saved colours" className="flex flex-wrap gap-1.5">
            {saved.map((color) => (
              <li key={color} className="group/saved relative">
                <button
                  type="button"
                  aria-label={`Use ${color}`}
                  title={color}
                  className={cn(
                    "block size-6 rounded-md border border-black/10",
                    color === current && "ring-2 ring-primary ring-offset-1 ring-offset-card",
                  )}
                  style={{ background: color }}
                  onClick={() => {
                    set(hexToHsv(color));
                  }}
                />
                <button
                  type="button"
                  aria-label={`Remove ${color}`}
                  className="absolute -top-1 -right-1 hidden size-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground group-focus-within/saved:flex group-hover/saved:flex"
                  onClick={() => {
                    removeSavedColor(color);
                  }}
                >
                  <X aria-hidden className="size-2.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
