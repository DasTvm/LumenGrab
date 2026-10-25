import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { Check, Copy, Droplet, Lock, Pencil, X } from "lucide-react";
import { platform, type PinState } from "@/platform";
import { currentOs } from "@/platform/os";
import { cn } from "@/ui/lib/utils";

const MIN_OPACITY = 20;

/**
 * A pinned capture (design: "M6 / Pin"): the picture floats above other windows with no frame. Moving the
 * pointer over it shows a small bar; the wheel resizes it, a right-click opens the menu. "Locked" lets
 * clicks go through to what is behind it. Everything it does goes through the window it lives in.
 */
export function PinWindow() {
  const [state, setState] = useState<PinState | null>(null);
  const [opacity, setOpacity] = useState(100);
  const [hover, setHover] = useState(false);
  const [slider, setSlider] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windows = currentOs() === "windows";

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }, []);

  const flash = (text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => {
      setNote(null);
    }, 1600);
  };

  useEffect(() => {
    const life = { alive: true, stops: [] as (() => void)[] };
    const keep = (off: () => void) => {
      if (life.alive) life.stops.push(off);
      else off();
    };
    void platform.getPinState().then((initial) => {
      if (life.alive && initial) setState(initial);
    });
    void platform
      .onPinState((next) => {
        setState((before) => {
          if (before && next.percent !== before.percent) flash(`${String(next.percent)}%`);
          if (before && next.locked && !before.locked) flash("Locked");
          return next;
        });
      })
      .then(keep);
    void platform
      .onPinOpacity((percent) => {
        setOpacity(percent);
        flash(`Opacity ${String(percent)}%`);
      })
      .then(keep);
    return () => {
      life.alive = false;
      for (const stop of life.stops) stop();
      if (noteTimer.current) clearTimeout(noteTimer.current);
    };
  }, []);

  const copy = () => {
    platform.pinCopy().then(
      () => {
        flash("Copied");
      },
      () => {
        flash("Could not copy");
      },
    );
  };

  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape" || (mod && e.key.toLowerCase() === "w")) {
      e.preventDefault();
      void platform.pinClose();
    } else if (mod && e.key.toLowerCase() === "c") {
      e.preventDefault();
      copy();
    } else if (mod && e.key.toLowerCase() === "l") {
      e.preventDefault();
      void platform.pinSetLocked(true);
    } else if (e.key === "+" || e.key === "=") {
      void platform.pinZoom(true);
    } else if (e.key === "-") {
      void platform.pinZoom(false);
    } else if (e.key === "0") {
      void platform.pinResetSize();
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("[data-bar]")) return;
    void platform.pinDrag();
  };

  const onWheel = (e: WheelEvent) => {
    if (e.deltaY === 0) return;
    void platform.pinZoom(e.deltaY < 0);
  };

  if (!state) return <div className="h-screen w-screen" />;
  const locked = state.locked;

  return (
    <div
      role="application"
      aria-label={`Pinned capture ${state.name}`}
      tabIndex={0}
      className={cn(
        "relative h-screen w-screen overflow-hidden outline-none",
        windows ? "rounded-lg" : "rounded-[10px]",
      )}
      onKeyDown={onKey}
      onPointerDown={onPointerDown}
      onPointerEnter={() => {
        setHover(true);
      }}
      onPointerLeave={() => {
        setHover(false);
        setSlider(false);
      }}
      onWheel={onWheel}
      onContextMenu={(e) => {
        e.preventDefault();
        void platform.pinMenu();
      }}
    >
      <img
        src={platform.pinImageUrl()}
        alt={state.name}
        draggable={false}
        style={{ opacity: opacity / 100 }}
        className="size-full bg-white object-fill select-none"
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 border border-black/15",
          windows ? "rounded-lg" : "rounded-[10px]",
        )}
      />

      {hover && !locked ? (
        <div
          data-bar
          role="toolbar"
          aria-label="Pin"
          className="absolute inset-x-0 top-0 flex items-center gap-1 bg-toast/95 px-2 py-1.5 text-toast-foreground"
        >
          <BarButton
            label="Opacity"
            active={slider}
            onClick={() => {
              setSlider((on) => !on);
            }}
          >
            <Droplet className="size-3.5" aria-hidden />
            <span className="text-xs tabular-nums">{opacity}%</span>
          </BarButton>
          {state.percent !== 100 ? (
            <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs tabular-nums">
              {state.percent}%
            </span>
          ) : null}
          <div className="flex-1" />
          <BarButton label="Copy image" onClick={copy}>
            <Copy className="size-3.5" aria-hidden />
          </BarButton>
          <BarButton
            label="Edit"
            onClick={() => {
              void platform.pinEdit();
            }}
          >
            <Pencil className="size-3.5" aria-hidden />
          </BarButton>
          <BarButton
            label="Lock (click-through)"
            onClick={() => {
              void platform.pinSetLocked(true);
            }}
          >
            <Lock className="size-3.5" aria-hidden />
          </BarButton>
          <span aria-hidden className="mx-0.5 h-4 w-px bg-white/20" />
          <BarButton
            label="Close pin"
            onClick={() => {
              void platform.pinClose();
            }}
          >
            <X className="size-3.5" aria-hidden />
          </BarButton>
        </div>
      ) : null}

      {hover && slider && !locked ? (
        <div
          data-bar
          className="absolute top-10 left-2 flex w-[200px] flex-col gap-2 rounded-lg bg-toast p-3 text-toast-foreground shadow-lg"
        >
          <div className="flex items-center justify-between text-xs">
            <span>Opacity</span>
            <span className="tabular-nums">{opacity}%</span>
          </div>
          <input
            type="range"
            aria-label="Opacity"
            min={MIN_OPACITY}
            max={100}
            step={5}
            value={opacity}
            onChange={(e) => {
              setOpacity(Number(e.target.value));
            }}
            className="accent-[var(--lg-brand)]"
          />
          <div className="flex justify-between text-[10px] opacity-60">
            <span>{MIN_OPACITY}%</span>
            <span>100%</span>
          </div>
        </div>
      ) : null}

      {locked ? (
        <>
          <span
            role="img"
            aria-label="Locked"
            className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-toast text-toast-foreground"
          >
            <Lock className="size-3.5" aria-hidden />
          </span>
          <div
            role="status"
            className="absolute inset-x-2 bottom-2 rounded-md bg-toast px-3 py-2 text-xs text-toast-foreground"
          >
            Locked. Clicks go through to what is behind it. Unlock:{" "}
            {windows ? "Ctrl Shift U" : "⌃ ⇧ U"} or the tray menu
          </div>
        </>
      ) : null}

      {note && !locked ? (
        <div
          role="status"
          className="pointer-events-none absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-toast px-3 py-1 text-xs text-toast-foreground"
        >
          {note === "Copied" ? <Check className="size-3 text-brand" aria-hidden /> : null}
          {note}
        </div>
      ) : null}
    </div>
  );
}

function BarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded p-1.5 outline-none hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-ring",
        active && "bg-white/15",
      )}
    >
      {children}
    </button>
  );
}
