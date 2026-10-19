import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { Point, Rect } from "@/document/schema";
import { drawLayers } from "../draw/draw";
import { ensureFonts } from "../draw/fonts";
import type { BaseImage } from "./base-image";
import { useEditor, useStores, useUi } from "./context";
import { SelectionOverlay } from "./SelectionOverlay";
import { TextEditor } from "./TextEditor";
import { ZoomBar } from "./ZoomBar";
import { finishEditing, startEditText } from "./text-edit";
import { measureTextLayer } from "../draw/text-measure";
import { isGroup } from "@/document/layers";
import { hitTest } from "../model/geometry";
import type { Layer } from "@/document/schema";
import { CropController } from "./crop-tool";
import { CropOverlay } from "./CropOverlay";
import { DrawController } from "./draw-tool";
import { SelectController, type PointerInfo } from "./select-tool";
import { fitView, toImage, wheelZoom, zoomAt } from "./view";
import { computeLayout } from "@/presentation/compose";
import { drawComposition, ensureFrameFonts } from "@/presentation/draw-presentation";
import { useBackgroundBitmap } from "./background-image";
import { renderPicture } from "./picture";
import { minFrameGap, recordPaint } from "@/shader/pace";
import { posterSeconds, sceneMoves } from "@/shader/scene";
import { useReducedMotion } from "@/ui/lib/use-reduced-motion";
import { SafeAreaOverlay } from "./SafeAreaOverlay";

interface Props {
  base: BaseImage;
}

/** While the background plays it is drawn at this size at most: it is smooth, and the graphics card has 30 pictures a second to make. */
const PLAY_EDGE = 1024;

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

/**
 * The canvas area: the picture with its layers, zoom and pan, and the pointer. One 2D canvas draws the
 * baked picture and then the layers with `drawLayers`, the very function the export uses. The
 * selection handles are an SVG on top (`SelectionOverlay`).
 */
export function EditorCanvas({ base }: Props) {
  const { editor, ui, session } = useStores();
  const project = useEditor((s) => s.project);
  const mode = useUi((s) => s.mode);
  const view = useUi((s) => s.view);
  const tool = useUi((s) => s.tool);
  const panning = useUi((s) => s.panning);
  const editing = useUi((s) => s.editing);

  const areaRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [fontRev, bumpFonts] = useReducer((n: number) => n + 1, 0);
  const [cursor, setCursor] = useState("default");
  const [, redrawOverlay] = useReducer((n: number) => n + 1, 0);
  const panDrag = useRef<{ x: number; y: number; view: NonNullable<typeof view> } | null>(null);

  const controller = useMemo(
    () => new SelectController(editor, ui, measureTextLayer),
    [editor, ui],
  );
  const drawing = useMemo(
    () => new DrawController(editor, ui, controller, measureTextLayer),
    [editor, ui, controller],
  );
  const cropper = useMemo(() => new CropController(ui), [ui]);
  /** The controller of the active tool. */
  const current = useCallback(() => {
    const t = ui.getState().tool;
    if (t === "select") return controller;
    return t === "crop" ? cropper : drawing;
  }, [ui, controller, drawing, cropper]);
  const cropping = tool === "crop" && mode === "annotate";
  // Presentation mode shows the finished composition; there is nothing to select or draw in it.
  const presenting = mode === "presentation" && project.presentation.enabled;
  const animateOn = useUi((s) => s.animate);
  const studioOpen = useUi((s) => s.studio);
  const codeVersion = useUi((s) => s.codeVersion);
  const reduced = useReducedMotion();
  const scene =
    project.presentation.background.type === "shader" ? project.presentation.background : null;
  // An animated background plays while the presentation is shown, unless it is switched off, the system asks for less motion, or the Studio is open (it plays its own).
  const playing =
    presenting && scene !== null && sceneMoves(scene) && animateOn && !reduced && !studioOpen;
  const stillSeconds = scene ? posterSeconds(scene) : 0;
  /** Where the animation is, in seconds. Restarts at the still frame whenever that, the loop or the scene changes. */
  const clock = useRef<{ from: number; at: number; seconds: number } | null>(null);
  const picture = project.crop ?? { x: 0, y: 0, width: base.width, height: base.height };
  const layout = useMemo(
    () => (presenting ? computeLayout(picture, project.presentation) : null),
    [presenting, picture.width, picture.height, project.presentation], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // While the crop tool is open the whole picture is shown, with the frame on it.
  const content: Rect = layout
    ? { x: 0, y: 0, width: layout.canvas.width, height: layout.canvas.height }
    : !cropping && project.crop
      ? project.crop
      : { x: 0, y: 0, width: base.width, height: base.height };
  const background = useBackgroundBitmap(session.assets, project.presentation.background);
  const pictureCanvas = useMemo(
    () => (presenting ? renderPicture(base, project.layers, project.crop) : null),
    [presenting, base, project.layers, project.crop, fontRev], // eslint-disable-line react-hooks/exhaustive-deps
  );

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

  // What Fit and 100 % centre on.
  useEffect(() => {
    ui.getState().setStage(layout ? content : null);
  }, [ui, layout, content.width, content.height]); // eslint-disable-line react-hooks/exhaustive-deps

  // The frame's title bar text needs its fonts.
  useEffect(() => {
    if (!presenting) return;
    let current = true;
    void ensureFrameFonts(project.presentation.frame).then(() => {
      if (current) bumpFonts();
    });
    return () => {
      current = false;
    };
  }, [presenting, project.presentation.frame]);

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
  const paint = useCallback(() => {
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
    if (layout && pictureCanvas) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.setTransform(1, 0, 0, 1, dpr * view.x, dpr * view.y);
      drawComposition(
        ctx,
        {
          content: pictureCanvas,
          presentation: project.presentation,
          backgroundImage: background,
          shaderSeconds: playing && clock.current ? clock.current.seconds : stillSeconds,
          ...(playing ? { shaderMaxEdge: PLAY_EDGE } : {}),
        },
        layout,
        dpr * view.zoom,
      );
      return;
    }
    base.update(project.layers);
    // The text being typed in is the text field, not drawn twice.
    const shown = editing ? withoutLayer(project.layers, editing.id) : project.layers;
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
    drawLayers(ctx, shown, { width: base.width, height: base.height });
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
    editing,
    layout,
    pictureCanvas,
    background,
    project.presentation,
    playing,
    stillSeconds,
  ]);
  useEffect(() => {
    paint();
  }, [paint, fontRev, codeVersion]);

  // The animation: about 30 pictures a second, from the still frame, round and round the loop.
  useEffect(() => {
    if (!playing) {
      clock.current = null;
      return;
    }
    const loop = scene.loop;
    if (!clock.current || clock.current.from !== stillSeconds) {
      clock.current = { from: stillSeconds, at: performance.now(), seconds: stillSeconds };
    }
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < minFrameGap()) return;
      last = now;
      const state = clock.current;
      if (!state) return;
      state.seconds = (state.from + (now - state.at) / 1000) % loop;
      paint();
      recordPaint(performance.now() - now);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing, scene, stillSeconds, paint]);

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
    if (ui.getState().mode === "presentation") return; // only panning in Presentation mode
    // A press on the picture ends the text being typed (the field's own blur does too).
    finishEditing(editor, ui);
    const pointer = info(e);
    if (pointer) current().down(pointer);
    redrawOverlay();
  };

  /** Double-click on a text edits it, with any tool. */
  const onDoubleClick = (e: React.MouseEvent) => {
    if (ui.getState().mode === "presentation") return;
    const pointer = info(e);
    if (!pointer) return;
    const hit = hitTest(
      editor.getState().project.layers,
      pointer.p,
      6 / (ui.getState().view?.zoom ?? 1),
      {
        enterGroups: true,
        measure: measureTextLayer,
      },
    );
    if (hit) startEditText(editor, ui, hit);
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
    if (ui.getState().mode === "presentation") return;
    const pointer = info(e);
    const active = current();
    if (!pointer) return;
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
    if (ui.getState().mode === "presentation") return;
    const pointer = info(e);
    if (pointer) current().up(pointer);
    redrawOverlay();
  };

  // Esc cancels a drag in progress.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && (controller.active || drawing.active || cropper.active)) {
        controller.cancel();
        drawing.cancel();
        cropper.cancel();
        redrawOverlay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [controller, drawing, cropper]);

  const shownCursor = presenting
    ? "default"
    : panning
      ? "grab"
      : tool === "select" || cursor !== "default"
        ? cursor
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
      onDoubleClick={onDoubleClick}
    >
      <canvas
        ref={canvasRef}
        data-testid="editor-canvas"
        aria-label={presenting ? "Presentation" : "Picture with annotations"}
        className="absolute inset-0 size-full"
      />
      {view && mode === "annotate" ? (
        <SelectionOverlay
          view={view}
          size={size}
          controller={controller}
          showFrame={tool !== "crop"}
          fontRev={fontRev}
        />
      ) : null}
      {view && cropping ? <CropOverlay view={view} size={size} /> : null}
      {view && mode === "annotate" ? <TextEditor view={view} /> : null}
      {view && layout ? <SafeAreaOverlay view={view} layout={layout} /> : null}
      <ZoomBar area={size} />
    </div>
  );
}

/** The layers without one (the text being typed in), keeping groups and order. */
function withoutLayer(layers: readonly Layer[], id: string): Layer[] {
  return layers
    .filter((l) => l.id !== id)
    .map((l) => (isGroup(l) ? { ...l, layers: withoutLayer(l.layers, id) } : l));
}
