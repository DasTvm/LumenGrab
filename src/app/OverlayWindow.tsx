import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  clampPoint,
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
import { platform, type OverlaySession, type OverlayWindowInfo } from "@/platform";
import { Button } from "@/ui/components/button";

interface OverlayParams {
  sessionId: string;
  displayId: number;
}

function readParams(): OverlayParams | null {
  const q = new URLSearchParams(window.location.search);
  const sessionId = q.get("session");
  const displayId = Number(q.get("display"));
  return sessionId && Number.isInteger(displayId) ? { sessionId, displayId } : null;
}

function viewport(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * One overlay per display. Shows that display's frozen frame, dims it, and lets the user drag an
 * area or pick a window. All coordinates sent to the native side are frame pixels of this display.
 * Esc cancels. Window mode is fully keyboard operable (Tab / arrows to choose, Enter to capture).
 */
export function OverlayWindow() {
  const params = useMemo(() => readParams(), []);
  const [session, setSession] = useState<OverlaySession | null>(null);
  const [error, setError] = useState<string | null>(
    params ? null : "This capture overlay was opened without a session.",
  );
  const [size, setSize] = useState<Size>(viewport);
  const [drag, setDrag] = useState<{ start: Point; current: Point } | null>(null);
  const [hovered, setHovered] = useState<OverlayWindowInfo | undefined>(undefined);
  const sentReady = useRef(false);

  const cancel = useCallback(() => {
    if (params) void platform.cancelCapture(params.sessionId);
  }, [params]);

  useEffect(() => {
    if (!params) return;
    platform
      .getOverlaySession(params.sessionId, params.displayId)
      .then(setSession, (e: unknown) => {
        setError(e instanceof Error ? e.message : "The capture could not be loaded.");
      });
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

  const px: Size | null = session
    ? { width: session.display.pixelWidth, height: session.display.pixelHeight }
    : null;

  const submitWindow = useCallback(
    (w: OverlayWindowInfo | undefined) => {
      if (params && w) void platform.submitWindow(params.sessionId, w.id);
    },
    [params],
  );

  // Keyboard: Esc always cancels. Window mode: Tab/arrows cycle, Enter captures.
  useEffect(() => {
    const windows = session?.mode === "window" ? session.windows : [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
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
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [session, hovered, cancel, submitWindow]);

  const localPoint = (e: PointerEvent): Point => clampPoint({ x: e.clientX, y: e.clientY }, size);

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0 || !session) return;
    if (session.mode === "window") {
      submitWindow(hovered);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    setDrag({ start: p, current: p });
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!session || !px) return;
    const p = localPoint(e);
    if (session.mode === "window") {
      setHovered(hitTestWindow(session.windows, cssPointToPixelPoint(p, size, px)));
    } else if (drag) {
      setDrag({ start: drag.start, current: p });
    }
  };

  const onPointerUp = () => {
    if (!drag || !session || !params || !px) return;
    const rect = normalizeRect(drag.start, drag.current);
    setDrag(null);
    if (!isSelectionBigEnough(rect)) return; // accidental click: keep selecting
    void platform.submitArea(
      params.sessionId,
      params.displayId,
      cssRectToPixelRect(rect, size, px),
    );
  };

  const selection: Rect | null = drag
    ? normalizeRect(drag.start, drag.current)
    : session?.mode === "window" && hovered && px
      ? pixelRectToCssRect(hovered, size, px)
      : null;

  const label = (() => {
    if (!selection || !px || !session) return null;
    if (drag) {
      const r = cssRectToPixelRect(selection, size, px);
      return `${String(r.width)} × ${String(r.height)}`;
    }
    return hovered
      ? `${hovered.appName} · ${hovered.title} (${String(hovered.width)} × ${String(hovered.height)})`
      : null;
  })();

  const hint =
    session?.mode === "window"
      ? "Click a window to capture it · Esc to cancel"
      : "Drag to select an area · Esc to cancel";

  if (error) {
    return (
      <main className="bg-background text-foreground flex h-screen flex-col items-center justify-center gap-4 p-6">
        <p role="alert" className="text-destructive text-sm">
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
        session?.mode === "window" ? "Choose a window to capture" : "Select an area to capture"
      }
      className="fixed inset-0 cursor-crosshair overflow-hidden bg-black select-none"
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
          onLoad={() => {
            if (params && !sentReady.current) {
              sentReady.current = true;
              void platform.overlayReady(params.sessionId, params.displayId);
            }
          }}
          onError={() => {
            setError("The captured screen could not be loaded.");
          }}
        />
      ) : null}

      {/* Dim everything; the selection cuts a bright hole through the scrim. */}
      {selection ? (
        <div
          data-testid="selection"
          className="outline-accent pointer-events-none absolute shadow-[0_0_0_100vmax_var(--lg-scrim)] outline-2"
          style={{
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
          }}
        />
      ) : (
        <div className="bg-scrim pointer-events-none absolute inset-0" />
      )}

      {label && selection ? (
        <div
          data-testid="selection-label"
          className="bg-primary text-primary-foreground pointer-events-none absolute rounded-md px-2 py-1 text-xs tabular-nums"
          style={{
            left: Math.min(selection.x, Math.max(size.width - 240, 0)),
            top:
              selection.y + selection.height + 8 + 28 > size.height
                ? Math.max(selection.y - 32, 0)
                : selection.y + selection.height + 8,
          }}
        >
          {label}
        </div>
      ) : null}

      {!drag && session ? (
        <p
          aria-live="polite"
          className="bg-primary text-primary-foreground pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-md px-3 py-1.5 text-sm"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
