import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Point, Rect } from "@/document/schema";
import { drawLayers } from "../draw/draw";
import { ensureFonts } from "../draw/fonts";
import type { BaseImage } from "./base-image";
import { useEditor, useStores, useUi } from "./context";
import { SelectionOverlay } from "./SelectionOverlay";
import { ZoomBar } from "./ZoomBar";
import { DrawController } from "./draw-tool";
import { SelectController, type PointerInfo } from "./select-tool";
import { fitView, toImage, wheelZoom, zoomAt } from "./view";

interface Props {
  base: BaseImage;
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/**
 * The canvas area: the picture with its layers, zoom and pan, and the pointer. One 2D canvas draws the
 * baked picture and then the layers with `drawLayers`, the very function the export uses. The
 * selection handles are an SVG on top (`SelectionOverlay`).
 */
export function EditorCanvas({ base }: Props) {
  const { editor, ui } = useStores();
  const project = useEditor((s) => s.project);
  const view = useUi((s) => s.view);
  const tool = useUi((s) => s.tool);
  const panning = useUi((s) => s.panning);

  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fontRev, bumpFonts] = useReducer((n: number) => n + 1, 0);
  const [cursor, setCursor] = useState("default");
  const [, redrawOverlay] = useReducer((n: number) => n + 1, 0);
  const panDrag = useRef<{ x: number; y: number; view: NonNullable<typeof view> } | null>(null);

  const controller = useMemo(() => new SelectController(editor, ui), [editor, ui]);
  const drawing = useMemo(
    () => new DrawController(editor, ui, controller),
    [editor, ui, controller],
  );
  /** The controller of the active tool; `null` for tools that have none yet (text, crop). */
  const current = useCallback(() => {
    const t = ui.getState().tool;
    if (t === "select") return controller;
    return t === "text" || t === "crop" ? null : drawing;
  }, [ui, controller, drawing]);
  const content: Rect = project.crop ?? { x: 0, y: 0, width: base.width, height: base.height };

  // Measure the area.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => {
      const next = { width: el.clientWidth, height: el.clientHeight };
      setSize(next);
      ui.getState().setArea(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ui]);

  // Fit until the user zooms or pans.
  useEffect(() => {
    if (size.width === 0) return;
    const current = ui.getState();
    if (current.view === null || current.fit) {
      ui.getState().setView(fitView(size, content), true);
    }
  }, [size, content.x, content.y, content.width, content.height, ui]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fonts the text layers use must be loaded before they are drawn.
  useEffect(() => {
    let current = true;
    void ensureFonts(project.layers).then(() => {
      if (current) bumpFonts();
    });
    return () => {
      current = false;
    };
  }, [project.layers]);

  // Draw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view || size.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.width * dpr);
    const h = Math.round(size.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    base.update(project.layers);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
    // A soft shadow under the picture (design: Image Stack).
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.18)";
    ctx.shadowBlur = (28 * dpr) / 1;
    ctx.shadowOffsetY = 10 * dpr;
    ctx.fillStyle = "#ffffff";
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillRect(
      dpr * (view.x + content.x * view.zoom),
      dpr * (view.y + content.y * view.zoom),
      dpr * content.width * view.zoom,
      dpr * content.height * view.zoom,
    );
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.rect(content.x, content.y, content.width, content.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = view.zoom < 2;
    ctx.drawImage(base.canvas, 0, 0);
    drawLayers(ctx, project.layers, { width: base.width, height: base.height });
    ctx.restore();
  }, [
    base,
    project.layers,
    view,
    size,
    content.x,
    content.y,
    content.width,
    content.height,
    fontRev,
  ]);

  const toArea = useCallback((clientX: number, clientY: number): Point => {
    const rect = areaRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  const info = useCallback(
    (e: {
      clientX: number;
      clientY: number;
      shiftKey: boolean;
      altKey: boolean;
      metaKey: boolean;
      ctrlKey: boolean;
    }): PointerInfo | null => {
      const v = ui.getState().view;
      if (!v) return null;
      return {
        p: toImage(v, toArea(e.clientX, e.clientY)),
        shift: e.shiftKey,
        alt: e.altKey,
        mod: isMac ? e.metaKey : e.ctrlKey,
      };
    },
    [toArea, ui],
  );

  // Wheel: cmd/ctrl (and a trackpad pinch) zooms around the pointer, a plain wheel pans.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const v = ui.getState().view;
      if (!v) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const anchor = toArea(e.clientX, e.clientY);
        ui.getState().setView(zoomAt(v, anchor, wheelZoom(v.zoom, e.deltaY, e.ctrlKey)));
      } else {
        ui.getState().setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
    };
  }, [toArea, ui]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = ui.getState().view;
    if (!v) return;
    if (e.button === 1 || ui.getState().panning) {
      e.preventDefault();
      panDrag.current = { ...toArea(e.clientX, e.clientY), view: v };
      setCursor("grabbing");
      return;
    }
    const pointer = info(e);
    if (pointer) current()?.down(pointer);
    redrawOverlay();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const v = ui.getState().view;
    if (panDrag.current && v) {
      const at = toArea(e.clientX, e.clientY);
      ui.getState().setView({
        ...panDrag.current.view,
        x: panDrag.current.view.x + at.x - panDrag.current.x,
        y: panDrag.current.view.y + at.y - panDrag.current.y,
      });
      return;
    }
    const pointer = info(e);
    const active = current();
    if (!pointer || !active) return;
    if (active.active) {
      active.move(pointer);
      redrawOverlay();
    } else {
      setCursor(active.cursor(pointer.p));
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    if (panDrag.current) {
      panDrag.current = null;
      setCursor(ui.getState().panning ? "grab" : "default");
      return;
    }
    const pointer = info(e);
    if (pointer) current()?.up(pointer);
    redrawOverlay();
  };

  // Esc cancels a drag in progress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (controller.active || drawing.active)) {
        controller.cancel();
        drawing.cancel();
        redrawOverlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [controller, drawing]);

  const shownCursor = panning
    ? "grab"
    : tool === "select" || cursor !== "default"
      ? cursor
      : tool === "crop"
        ? "default"
        : "crosshair";

  return (
    <div
      ref={areaRef}
      data-testid="editor-canvas-area"
      className="relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden bg-muted select-none"
      style={{ cursor: shownCursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <canvas
        ref={canvasRef}
        data-testid="editor-canvas"
        aria-label="Picture with annotations"
        className="absolute inset-0 size-full"
      />
      {view ? (
        <SelectionOverlay
          view={view}
          size={size}
          controller={controller}
          showFrame={tool !== "crop"}
        />
      ) : null}
      <ZoomBar area={size} />
    </div>
  );
}
