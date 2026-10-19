import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { cn } from "@/ui/lib/utils";
import { computeLayout } from "@/presentation/compose";
import {
  drawComposition,
  drawShaderBackground,
  ensureFrameFonts,
} from "@/presentation/draw-presentation";
import { patchLayer } from "@/shader/edit";
import { sharedRenderer, webglAvailable } from "@/shader/renderer";
import type { ShaderScene } from "@/shader/types";
import type { BaseImage } from "../base-image";
import { useEditor, useUi } from "../context";
import { renderPicture } from "../picture";
import { ColorChip } from "../presentation/fields";
import { useStudio, useStudioStore } from "./context";

type Zoom = "fit" | 0.5 | 1;

/** What the preview draws: the scene, or only the soloed layer of it. */
export function viewScene(scene: ShaderScene, solo: string | null): ShaderScene {
  if (solo === null) return scene;
  return {
    ...scene,
    layers: scene.layers.map((l) => ({ ...l, enabled: l.enabled && l.id === solo })),
  };
}

/** The picture in the middle of the Studio: the scene with the screenshot on it, or the scene alone. */
export function Preview({ base }: { base: BaseImage }) {
  const store = useStudioStore();
  const project = useEditor((s) => s.project);
  const scene = useStudio((s) => s.scene);
  const solo = useStudio((s) => s.solo);
  const time = useStudio((s) => s.time);
  const screenshot = useStudio((s) => s.screenshot);
  const playing = useStudio((s) => s.playing);
  const codeVersion = useUi((s) => s.codeVersion);
  const area = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [fontRev, setFontRev] = useState(0);
  const noGl = !webglAvailable();
  const frames = useRef(0);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const measure = () => {
      setSize({ width: el.clientWidth, height: el.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const picture = useMemo(
    () => project.crop ?? { x: 0, y: 0, width: base.width, height: base.height },
    [project.crop, base.width, base.height],
  );
  const presentation = useMemo(
    () => ({ ...project.presentation, enabled: true, background: scene }),
    [project.presentation, scene],
  );
  const layout = useMemo(() => computeLayout(picture, presentation), [picture, presentation]);
  const content = useMemo(
    () => renderPicture(base, project.layers, project.crop),
    [base, project.layers, project.crop],
  );
  useEffect(() => {
    let alive = true;
    void ensureFrameFonts(presentation.frame).then(() => {
      if (alive) setFontRev((n) => n + 1);
    });
    return () => {
      alive = false;
    };
  }, [presentation.frame]);

  // How big the canvas is shown, in CSS pixels.
  const shape = layout.canvas;
  const fit = Math.min(
    Math.max(0, size.width - 64) / shape.width,
    Math.max(0, size.height - 140) / shape.height,
  );
  const factor = zoom === "fit" ? fit : zoom;
  const cssW = Math.max(1, Math.round(shape.width * factor));
  const cssH = Math.max(1, Math.round(shape.height * factor));

  const paint = useCallback(() => {
    const el = canvas.current;
    if (!el || size.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    // The shader needs no more pixels than the screen shows; a lot bigger only costs time.
    const w = Math.min(Math.round(cssW * dpr), 1600);
    const h = Math.max(1, Math.round((w * shape.height) / shape.width));
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;
    const shown = viewScene(scene, solo);
    const scale = w / shape.width;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Every 20th frame a layer with code is timed: one that is too slow is switched off.
    frames.current += 1;
    const measure =
      frames.current % 20 === 0 && shown.layers.some((l) => l.kind === "custom" && l.enabled);
    if (screenshot) {
      drawComposition(
        ctx,
        {
          content,
          presentation: { ...presentation, background: shown },
          shaderSeconds: time,
          ...(playing ? { shaderMaxEdge: 1024 } : {}),
        },
        layout,
        scale,
      );
    } else {
      ctx.save();
      ctx.scale(scale, scale);
      drawShaderBackground(ctx, shown, shape.width, shape.height, scale, {
        seconds: time,
        purpose: "studio",
        ...(playing ? { maxEdge: 1024 } : {}),
      });
      ctx.restore();
    }
    if (measure) {
      // A small timed picture of the scene: a layer with code that takes too long is switched off.
      const report = sharedRenderer("measure")?.render(shown, time, 480, 270, { measure: true });
      if (report && report.heavy.length > 0) {
        for (const id of report.heavy) {
          store.getState().change((s) => patchLayer(s, id, { enabled: false }));
          store.getState().markHeavy(id);
        }
        store.getState().setNotice("A shader was switched off because it slowed the preview down.");
      }
    }
  }, [
    size.width,
    cssW,
    shape.width,
    shape.height,
    scene,
    solo,
    time,
    playing,
    screenshot,
    content,
    presentation,
    layout,
    store,
  ]);

  useEffect(() => {
    paint();
  }, [paint, fontRev, playing, codeVersion]);

  return (
    <div ref={area} className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-muted/50">
      <div
        className="absolute top-4 right-5 z-10 flex gap-0.5 rounded-lg border border-border bg-card p-0.5 text-xs shadow-sm"
        role="radiogroup"
        aria-label="Preview content"
      >
        {[
          { on: true, label: "With screenshot" },
          { on: false, label: "Background only" },
        ].map((o) => (
          <button
            key={o.label}
            type="button"
            role="radio"
            aria-checked={screenshot === o.on}
            className={cn(
              "h-7 rounded-md px-3",
              screenshot === o.on
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              store.getState().setScreenshot(o.on);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div
        className={cn(
          "flex min-h-0 flex-1 p-8",
          zoom === "fit" ? "items-center justify-center overflow-hidden" : "overflow-auto",
        )}
      >
        <div className="relative m-auto shrink-0" style={{ width: cssW, height: cssH }}>
          <canvas
            ref={canvas}
            data-testid="studio-preview"
            aria-label="Preview of the background"
            className="size-full rounded-sm shadow-[0_8px_30px_rgb(0_0_0/0.2)]"
          />
          {noGl ? (
            <div
              role="status"
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-sm bg-black/35 p-6 text-center text-white"
            >
              <p className="text-sm font-semibold">This computer can't show animated backgrounds</p>
              <p className="max-w-[360px] text-[13px]">
                The preview uses a plain colour instead. Your layers are kept, and the look still
                animates on other computers.
              </p>
              <label className="flex items-center gap-2 rounded-lg bg-card px-3 py-1.5 text-[13px] text-foreground">
                Fallback colour
                <ColorChip
                  label="Fallback colour"
                  value={scene.fallback}
                  size="size-6"
                  onChange={(hex) => {
                    store.getState().change((s) => ({ ...s, fallback: hex }));
                  }}
                />
              </label>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 px-5 pb-3">
        <div
          role="radiogroup"
          aria-label="Zoom"
          className="flex gap-0.5 rounded-lg border border-border bg-card p-0.5 text-xs shadow-sm"
        >
          {(
            [
              ["fit", "Fit"],
              [0.5, "50%"],
              [1, "100%"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={zoom === value}
              className={cn(
                "h-7 rounded-md px-3",
                zoom === value
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setZoom(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <span
          data-testid="studio-size"
          className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs text-muted-foreground shadow-sm"
        >
          <Maximize2 aria-hidden className="size-3" />
          {`${String(layout.output.width)} × ${String(layout.output.height)} px`}
        </span>
      </div>
    </div>
  );
}
