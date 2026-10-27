import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { AppWindow, Crosshair, Monitor, Repeat2, ScanLine, ScanText, X } from "lucide-react";
import {
  clampPoint,
  clampTranslation,
  cssPointToPixelPoint,
  cssRectToPixelRect,
  hitTestWindow,
  isSelectionBigEnough,
  normalizeRect,
  pixelRectToCssRect,
  type Point,
  type Rect,
  type Size,
} from "@/capture/geometry";
import {
  platform,
  type OverlayMode,
  type OverlaySession,
  type OverlayWindowInfo,
} from "@/platform";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";

interface OverlayParams {
  /** In the URL only in the browser mock; a native overlay is told its capture while it waits. */
  sessionId: string | null;
  displayId: number;
}

function readParams(): OverlayParams | null {
  const q = new URLSearchParams(window.location.search);
  const displayId = Number(q.get("display"));
  return q.get("display") !== null && Number.isInteger(displayId)
    ? { sessionId: q.get("session"), displayId }
    : null;
}

/** Whether a pointer drag has gone far enough to be an area and not a click. */
function moved(drag: { start: Point; current: Point }): boolean {
  return Math.hypot(drag.current.x - drag.start.x, drag.current.y - drag.start.y) > CLICK_SLOP;
}

function viewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** The 8 resize handles of the design (corners and edge midpoints), as fractions of the selection. */
const HANDLES: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 0.5],
  [1, 0.5],
  [0, 1],
  [0.5, 1],
  [1, 1],
];

const MODES: readonly {
  mode: OverlayMode | "fullscreen";
  label: string;
  /** The key that picks it while the capture bar is shown. */
  key?: string;
  icon: typeof ScanLine;
  /** The tooltip. */
  tip?: string;
}[] = [
  {
    mode: "allinone",
    label: "All-in-one",
    icon: Crosshair,
    tip: "All-in-one · click a window or drag an area",
  },
  { mode: "area", label: "Area", key: "A", icon: ScanLine },
  { mode: "window", label: "Window", key: "W", icon: AppWindow },
  { mode: "fullscreen", label: "Fullscreen", key: "F", icon: Monitor },
  {
    mode: "text",
    label: "Text",
    key: "T",
    icon: ScanText,
    tip: "Text · T. Copies only the text. No picture is kept.",
  },
];

/** A drag shorter than this is a click. */
const CLICK_SLOP = 4;

/**
 * One overlay per display (design: "Capture Overlay"). Shows that display's frozen frame, dims it,
 * and lets the user drag an area (hold Space to move it) or pick a window. All coordinates sent to
 * the native side are frame pixels of this display. Esc cancels. Window mode is fully keyboard
 * operable (Tab / arrows to choose, Enter to capture). The toolbar switches between area, window
 * and the whole display.
 */
function OverlaySurface({ sessionId, displayId }: { sessionId: string; displayId: number }) {
  const params = useMemo(() => ({ sessionId, displayId }), [sessionId, displayId]);
  const [session, setSession] = useState<OverlaySession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<Size>(viewport);
  const [mode, setMode] = useState<OverlayMode>("area");
  const [drag, setDrag] = useState<{ start: Point; current: Point } | null>(null);
  const [hovered, setHovered] = useState<OverlayWindowInfo | undefined>(undefined);
  /** Where the pointer is (CSS pixels), for the outline of "repeat the last area". */
  const [pointer, setPointer] = useState<Point | null>(null);
  /** "Repeat last" is on: the outline of the last area follows the pointer and a click takes it. Off until R is pressed. */
  const [repeating, setRepeating] = useState(false);
  const sentReady = useRef(false);
  const spaceHeld = useRef(false);
  const lastPointer = useRef<Point | null>(null);

  const cancel = useCallback(() => {
    void platform.cancelCapture(params.sessionId);
  }, [params]);

  useEffect(() => {
    platform.getOverlaySession(params.sessionId, params.displayId).then(
      (s) => {
        setSession(s);
        setMode(s.mode);
      },
      (e: unknown) => {
        setError(e instanceof Error ? e.message : "The capture could not be loaded.");
      },
    );
  }, [params]);

  // With several displays only one overlay sees the pointer. When it moves on to another display (or
  // another overlay becomes the key window), the highlight here must not stay behind as if a window
  // were still about to be captured.
  useEffect(() => {
    const clear = () => {
      setHovered(undefined);
      setPointer(null);
    };
    window.addEventListener("blur", clear);
    document.documentElement.addEventListener("pointerleave", clear);
    return () => {
      window.removeEventListener("blur", clear);
      document.documentElement.removeEventListener("pointerleave", clear);
    };
  }, []);

  // The capture bar lives on one display only: a mode switched there applies to all displays.
  useEffect(() => {
    let off: (() => void) | undefined;
    let disposed = false;
    void platform
      .onCaptureMode(params.sessionId, (next) => {
        setMode(next);
        setDrag(null);
        setHovered(undefined);
        setRepeating(false);
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, [params]);

  useEffect(() => {
    const onResize = () => {
      setSize(viewport());
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const px = useMemo<Size | null>(
    () =>
      session ? { width: session.display.pixelWidth, height: session.display.pixelHeight } : null,
    [session],
  );

  const submitWindow = useCallback(
    (w: OverlayWindowInfo | undefined) => {
      if (w) void platform.submitWindow(params.sessionId, w.id);
    },
    [params],
  );

  const captureFullDisplay = useCallback(() => {
    if (px) {
      void platform.submitArea(params.sessionId, params.displayId, {
        x: 0,
        y: 0,
        width: px.width,
        height: px.height,
      });
    }
  }, [params, px]);

  /** The last area again, centred on `at` (or the middle of the display) and kept on the screen. */
  const lastAreaAt = useCallback(
    (at: Point | null): Rect | null => {
      const last = session?.lastArea;
      if (!last) return null;
      const width = Math.min(last.width, size.width);
      const height = Math.min(last.height, size.height);
      const centre = at ?? { x: size.width / 2, y: size.height / 2 };
      return {
        x: Math.min(Math.max(centre.x - width / 2, 0), size.width - width),
        y: Math.min(Math.max(centre.y - height / 2, 0), size.height - height),
        width,
        height,
      };
    },
    [session, size],
  );
  const repeatRect = useMemo(() => lastAreaAt(pointer), [lastAreaAt, pointer]);

  /** Takes the last area where the pointer is (`at`: the pointer of the click itself, not of the last render). */
  const repeatLast = useCallback(
    (at: Point) => {
      const rect = lastAreaAt(at);
      if (!rect || !px) return;
      void platform.submitArea(
        params.sessionId,
        params.displayId,
        cssRectToPixelRect(rect, size, px),
      );
    },
    [lastAreaAt, px, size, params],
  );

  const chooseMode = useCallback(
    (next: OverlayMode | "fullscreen") => {
      if (next === "fullscreen") {
        captureFullDisplay();
        return;
      }
      setMode(next);
      setDrag(null);
      setHovered(undefined);
      setRepeating(false);
      void platform.setCaptureMode(params.sessionId, next);
    },
    [captureFullDisplay, params],
  );

  // Keyboard: Esc always cancels, Space moves a selection being dragged. Window mode: Tab/arrows
  // cycle, Enter captures.
  useEffect(() => {
    const windows = mode === "window" || mode === "allinone" ? (session?.windows ?? []) : [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
        return;
      }
      if (
        e.key.toLowerCase() === "r" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !drag &&
        session?.lastArea &&
        mode !== "window"
      ) {
        // R shows the last area at the pointer (and again hides it); a click takes it.
        e.preventDefault();
        setRepeating((on) => !on);
        setHovered(undefined);
        return;
      }
      const shortcut = session?.toolbar
        ? { a: "area", w: "window", f: "fullscreen", t: "text" }[e.key.toLowerCase()]
        : undefined;
      if (shortcut && !e.metaKey && !e.ctrlKey && !e.altKey && !drag) {
        e.preventDefault();
        chooseMode(shortcut as OverlayMode | "fullscreen");
        return;
      }
      if (e.code === "Space" && (mode === "area" || mode === "text" || mode === "allinone")) {
        e.preventDefault();
        spaceHeld.current = e.type === "keydown";
        return;
      }
      if (windows.length === 0) return;
      const index = hovered ? windows.findIndex((w) => w.id === hovered.id) : -1;
      if (e.key === "Tab" || e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? -1 : 1;
        setHovered(windows[(index + step + windows.length) % windows.length]);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        setHovered(windows[(index - 1 + windows.length) % windows.length]);
      } else if (e.key === "Enter") {
        e.preventDefault();
        submitWindow(hovered);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld.current = false;
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [session, mode, hovered, drag, cancel, submitWindow, chooseMode]);

  const localPoint = (e: PointerEvent): Point => clampPoint({ x: e.clientX, y: e.clientY }, size);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !session) return;
    if (repeating && session.lastArea) {
      repeatLast(localPoint(e));
      return;
    }
    if (mode === "window") {
      submitWindow(hovered);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    lastPointer.current = p;
    setDrag({ start: p, current: p });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!session || !px) return;
    const p = localPoint(e);
    setPointer(p);
    // All-in-one points at the window under the pointer until a drag has really begun.
    const dragging = drag && (mode !== "allinone" || moved(drag));
    if (mode === "window" || (mode === "allinone" && !dragging && !repeating)) {
      setHovered(hitTestWindow(session.windows, cssPointToPixelPoint(p, size, px)));
    }
    if (mode === "window") {
      // nothing else: the highlight is all there is
    } else if (drag) {
      const last = lastPointer.current;
      if (spaceHeld.current && last) {
        // Space held: move the whole selection with the pointer instead of resizing it.
        const { x: dx, y: dy } = clampTranslation(
          normalizeRect(drag.start, drag.current),
          p.x - last.x,
          p.y - last.y,
          size,
        );
        setDrag({
          start: { x: drag.start.x + dx, y: drag.start.y + dy },
          current: { x: drag.current.x + dx, y: drag.current.y + dy },
        });
      } else {
        setDrag({ start: drag.start, current: p });
      }
    }
    lastPointer.current = p;
  };

  const onPointerUp = () => {
    if (!drag || !session || !px) return;
    const rect = normalizeRect(drag.start, drag.current);
    setDrag(null);
    // All-in-one: a click (no drag) takes the window under the pointer.
    if (mode === "allinone" && !moved(drag)) {
      submitWindow(hovered);
      return;
    }
    if (!isSelectionBigEnough(rect)) return; // accidental click: keep selecting
    void platform.submitArea(
      params.sessionId,
      params.displayId,
      cssRectToPixelRect(rect, size, px),
    );
  };

  const dragShown = drag && (mode !== "allinone" || moved(drag));
  const selection: Rect | null = dragShown
    ? normalizeRect(drag.start, drag.current)
    : (mode === "window" || mode === "allinone") && hovered && px && !repeating
      ? pixelRectToCssRect(hovered, size, px)
      : null;
  // The outline of the last area: only after R (or the bar's "Repeat last"), never by itself.
  const showRepeat = repeating && !!repeatRect && !selection && !drag;

  const label = (() => {
    if (!selection || !px) return null;
    if (dragShown) {
      const r = cssRectToPixelRect(selection, size, px);
      const dims = `${String(r.width)} × ${String(r.height)}`;
      return mode === "text" ? `Text · ${dims}` : dims;
    }
    return hovered
      ? `${hovered.appName} · ${hovered.title} · ${String(hovered.width)} × ${String(hovered.height)}`
      : null;
  })();

  const hint = repeating
    ? "Click to take this area again  ·  R to go back  ·  Esc to cancel"
    : mode === "window"
      ? "Click a window  ·  Tab to cycle  ·  Esc to cancel"
      : mode === "text"
        ? "Select text  ·  Esc to cancel"
        : mode === "allinone"
          ? hovered
            ? "Click to capture this window"
            : session?.toolbar
              ? "Click a window or drag an area"
              : "Click a window or drag an area  ·  Esc to cancel"
          : session?.lastArea
            ? "Drag to select  ·  R shows the last area  ·  Esc to cancel"
            : "Drag to select  ·  Space to move  ·  Esc to cancel";

  if (error) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-foreground">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
        <Button variant="outline" onClick={cancel} autoFocus>
          Close
        </Button>
      </main>
    );
  }

  return (
    <div
      role="application"
      aria-label={
        mode === "window"
          ? "Choose a window to capture"
          : mode === "allinone"
            ? "Click a window or drag an area to capture"
            : mode === "text"
              ? "Select the text to copy"
              : "Select an area to capture"
      }
      className={cn(
        "fixed inset-0 overflow-hidden bg-black select-none",
        (mode === "window" || mode === "allinone") && hovered
          ? "cursor-pointer"
          : "cursor-crosshair",
      )}
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => {
        e.preventDefault();
        cancel();
      }}
    >
      {session ? (
        <img
          src={session.frameUrl}
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 size-full"
          onLoad={(e) => {
            if (sentReady.current) return;
            sentReady.current = true;
            // The window is shown once this reports. A picture this large is decoded after it has loaded, so
            // it is decoded first: showing the window with the picture half ready flashes the black
            // background. (Not a frame callback: a hidden window never runs those.)
            const ready = () => {
              void platform.overlayReady(params.sessionId, params.displayId);
            };
            e.currentTarget.decode().then(ready, ready);
          }}
          onError={() => {
            setError("The captured screen could not be loaded.");
          }}
        />
      ) : null}

      {/* Dim everything; the selection cuts a bright hole through the scrim. */}
      {selection ? (
        <>
          <div
            data-testid="selection"
            className="pointer-events-none absolute shadow-[0_0_0_100vmax_var(--lg-scrim)] outline-2 outline-brand"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
            }}
          />
          {mode !== "window" && dragShown
            ? HANDLES.map(([fx, fy]) => (
                <span
                  key={`${String(fx)}-${String(fy)}`}
                  data-testid="handle"
                  className="pointer-events-none absolute size-2 rounded-[2px] border border-brand bg-white"
                  style={{
                    left: selection.x + fx * selection.width - 4,
                    top: selection.y + fy * selection.height - 4,
                  }}
                />
              ))
            : null}
        </>
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-scrim" />
      )}

      {showRepeat && px ? (
        <>
          <div
            data-testid="repeat-outline"
            className="pointer-events-none absolute border-2 border-dashed border-white/80"
            style={{
              left: repeatRect.x,
              top: repeatRect.y,
              width: repeatRect.width,
              height: repeatRect.height,
            }}
          />
          <div
            data-testid="repeat-label"
            className="pointer-events-none absolute rounded-full bg-overlay-surface px-2.5 py-1 text-xs font-semibold text-white tabular-nums"
            style={{
              left: repeatRect.x,
              top: repeatRect.y >= 34 ? repeatRect.y - 34 : repeatRect.y + 8,
            }}
          >
            {`${String(cssRectToPixelRect(repeatRect, size, px).width)} × ${String(cssRectToPixelRect(repeatRect, size, px).height)}`}
          </div>
        </>
      ) : null}

      {label && selection ? (
        <div
          data-testid="selection-label"
          className="pointer-events-none absolute max-w-[min(480px,90vw)] truncate rounded-full bg-brand px-2.5 py-1 text-xs font-semibold text-brand-foreground tabular-nums"
          style={{
            left: Math.min(selection.x, Math.max(size.width - 240, 0)),
            top: selection.y >= 34 ? selection.y - 34 : selection.y + 8,
          }}
        >
          {label}
        </div>
      ) : null}

      {session?.home ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-9 flex flex-col items-center gap-3">
          {!drag ? (
            <p
              aria-live="polite"
              className="text-xs text-white [text-shadow:0_1px_3px_rgb(0_0_0/0.6)]"
            >
              {hint}
            </p>
          ) : null}
          {session.toolbar ? (
            <div
              role="toolbar"
              aria-label="Capture mode"
              className="pointer-events-auto flex items-center gap-1 rounded-2xl bg-overlay-surface p-1.5 shadow-[0_10px_30px_rgb(0_0_0/0.4)]"
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onPointerMove={(e) => {
                e.stopPropagation();
              }}
            >
              {MODES.map(({ mode: m, label: text, key, icon: Icon, tip }) => {
                const active = m === mode;
                return (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={m === "fullscreen" ? undefined : active}
                    aria-keyshortcuts={key}
                    title={tip ?? `${text} (${key ?? ""})`}
                    onClick={() => {
                      chooseMode(m);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      active
                        ? "bg-brand text-brand-foreground"
                        : "text-overlay-foreground hover:bg-white/10",
                    )}
                  >
                    <Icon
                      className={cn("size-4", active ? "" : "text-overlay-muted")}
                      aria-hidden
                    />
                    {text}
                  </button>
                );
              })}
              <button
                type="button"
                disabled
                aria-label="Scroll (coming soon)"
                title="Scrolling capture is coming"
                className="flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-sm font-medium text-overlay-muted opacity-60"
              >
                Scroll
                <span className="rounded-full bg-white/15 px-1.5 py-px text-[10px] font-semibold">
                  Soon
                </span>
              </button>
              {session.lastArea ? (
                <>
                  <span aria-hidden className="mx-1 h-[22px] w-px bg-overlay-divider" />
                  <button
                    type="button"
                    aria-keyshortcuts="R"
                    aria-pressed={repeating}
                    title="Show the last area at the pointer (R)"
                    onClick={() => {
                      setRepeating((on) => !on);
                      setHovered(undefined);
                    }}
                    className={cn(
                      "flex items-center gap-2 rounded-[10px] px-3.5 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      repeating
                        ? "bg-brand text-brand-foreground"
                        : "text-overlay-foreground hover:bg-white/10",
                    )}
                  >
                    <Repeat2
                      className={cn("size-4", repeating ? "" : "text-overlay-muted")}
                      aria-hidden
                    />
                    Repeat last
                    <kbd className="rounded bg-white/15 px-1.5 text-[11px]">R</kbd>
                  </button>
                </>
              ) : null}
              <span aria-hidden className="mx-1 h-[22px] w-px bg-overlay-divider" />
              <button
                type="button"
                aria-label="Cancel capture"
                onClick={cancel}
                className="flex size-9 items-center justify-center rounded-[10px] text-overlay-muted outline-none hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-brand"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The overlay window of one display. Native overlays are created once, hidden, and wait here; the
 * native side tells them which capture to show (and later to go back to waiting). Each capture gets
 * a fresh `OverlaySurface`, so no state of the previous one is left behind.
 */
export function OverlayWindow() {
  const params = useMemo(() => readParams(), []);
  const [assigned, setAssigned] = useState<string | null>(params?.sessionId ?? null);
  const displayId = params?.displayId;
  const waiting = params !== null && params.sessionId === null;

  useEffect(() => {
    if (!waiting || displayId === undefined) return;
    let off: (() => void) | undefined;
    let disposed = false;
    // Listen first, then ask: a capture assigned in between is not missed.
    void platform
      .onOverlayAssignment(displayId, setAssigned)
      .then((unlisten) => {
        if (disposed) unlisten();
        else off = unlisten;
        return platform.getOverlayAssignment(displayId);
      })
      .then((current) => {
        if (current && !disposed) setAssigned((was) => was ?? current);
      });
    return () => {
      disposed = true;
      off?.();
    };
  }, [waiting, displayId]);

  if (!params) {
    return (
      <main className="flex h-screen flex-col items-center justify-center gap-4 bg-background p-6 text-foreground">
        <p role="alert" className="text-sm text-destructive">
          This capture overlay was opened without a session.
        </p>
        <Button
          variant="outline"
          autoFocus
          onClick={() => {
            window.close();
          }}
        >
          Close
        </Button>
      </main>
    );
  }
  if (!assigned) return <div className="fixed inset-0 bg-black" />;
  return <OverlaySurface key={assigned} sessionId={assigned} displayId={params.displayId} />;
}
