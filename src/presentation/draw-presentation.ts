import type { RgbaImage } from "@/document/render/pixels";
import type { Presentation } from "@/document/schema";
import { cssColor } from "@/editor/draw/color";
import type { Ctx2D } from "@/editor/draw/draw";
import { adjustImage, blurImage } from "./blur";
import { fitBox, type Layout } from "./compose";
import { drawFrameChrome, frameFonts } from "./frames";
import { linearLine, radialCircle, sortedStops } from "./gradient";
import { meshFieldSize, renderMeshField } from "./mesh";
import { posterSeconds } from "@/shader/scene";
import { sharedRenderer, type RenderReport } from "@/shader/renderer";
import type { ShaderScene } from "@/shader/types";

/**
 * Draws a presentation (docs/FORMAT.md section 4b): background, shadow, then the window with its frame
 * and the picture. The one drawing code of the editor's Presentation mode, the export, `preview.png`
 * and the automatic look; gradients, shadow and clipping are the canvas's, mesh and blur are our own
 * pixel code (`mesh.ts`, `blur.ts`) so they look the same in every WebView.
 */
type Canvas = OffscreenCanvas | HTMLCanvasElement;

export interface CompositionInput {
  /** The finished picture (redactions, annotations and crop applied), at its own pixel size. */
  content: CanvasImageSource;
  presentation: Presentation;
  /** The decoded background image, for an `image` background. Without it that background stays plain. */
  backgroundImage?: CanvasImageSource | null;
  /** The moment of a shader background to draw, in seconds. Without it the scene's still frame (docs/FORMAT.md section 4c). */
  shaderSeconds?: number;
  /** Whether the custom code of a shader background may run. Off unless the caller says it is the user's own. */
  trustCustomCode?: boolean;
}

/** The longest side of the picture a shader background is drawn at; bigger canvases scale it up (it is smooth). */
const SHADER_MAX_EDGE = 4096;

export function makeCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context2d(canvas: Canvas): Ctx2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This system cannot process images in the browser engine.");
  return ctx;
}

function sizeOf(source: CanvasImageSource): { width: number; height: number } {
  const s = source as { width?: number | SVGAnimatedLength; height?: number | SVGAnimatedLength };
  if (typeof s.width === "number" && typeof s.height === "number") {
    return { width: s.width, height: s.height };
  }
  const v = source as { videoWidth?: number; videoHeight?: number };
  return { width: v.videoWidth ?? 1, height: v.videoHeight ?? 1 };
}

/** Waits for the fonts the frame text needs (they load on first use). */
export async function ensureFrameFonts(frame: Presentation["frame"]): Promise<void> {
  if (typeof document === "undefined") return;
  await Promise.all(
    frameFonts(frame).map((font) => document.fonts.load(font, frame.title ?? frame.url ?? "A")),
  );
}

/**
 * A blurred picture the size of `width` x `height`: `source` laid over it as `fit` says, shrunk, blurred
 * (sigma = blur / 2, like a CSS shadow), tinted, and scaled back up. Working small keeps it fast.
 */
function blurredLayer(
  source: CanvasImageSource,
  width: number,
  height: number,
  fit: "cover" | "contain",
  zoom: number,
  blur: number,
  saturation: number,
  dim: number,
): Canvas {
  const down = Math.min(32, Math.max(1, Math.floor(blur / 3)));
  const sw = Math.max(8, Math.round(width / down));
  const sh = Math.max(8, Math.round(height / down));
  const small = makeCanvas(sw, sh);
  const sctx = context2d(small);
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  const box = fitBox(sizeOf(source), { width: sw, height: sh }, fit, zoom);
  sctx.drawImage(source, box.x, box.y, box.width, box.height);
  const raw = sctx.getImageData(0, 0, sw, sh);
  const image: RgbaImage = { width: sw, height: sh, data: raw.data };
  const blurred = blurImage(image, blur / 2 / (width / sw));
  adjustImage(blurred, saturation, dim);
  sctx.putImageData(new ImageData(new Uint8ClampedArray(blurred.data), sw, sh), 0, 0);
  const out = makeCanvas(width, height);
  const octx = context2d(out);
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(small, 0, 0, width, height);
  return out;
}

/**
 * Draws a shader background (docs/FORMAT.md section 4c) onto `ctx`, `width` x `height` composition pixels at `scale` device pixels per
 * pixel. Where WebGL is missing the scene's fallback colour is drawn. Returns what the renderer reported (`null` without WebGL).
 */
export function drawShaderBackground(
  ctx: Ctx2D,
  scene: ShaderScene,
  width: number,
  height: number,
  scale: number,
  options: {
    seconds?: number;
    trustCustomCode?: boolean;
    purpose?: string;
    measure?: boolean;
  } = {},
): RenderReport | null {
  const renderer = sharedRenderer(options.purpose ?? "still");
  const k = Math.min(1, SHADER_MAX_EDGE / Math.max(width * scale, height * scale, 1));
  const report =
    renderer?.render(
      scene,
      options.seconds ?? posterSeconds(scene),
      Math.max(1, Math.round(width * scale * k)),
      Math.max(1, Math.round(height * scale * k)),
      {
        allowCode: () => options.trustCustomCode === true,
        ...(options.measure ? { measure: true } : {}),
      },
    ) ?? null;
  ctx.save();
  if (renderer && report?.drawn) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(renderer.canvas, 0, 0, width, height);
  } else {
    ctx.fillStyle = cssColor(scene.fallback);
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
  return report;
}

function drawBackground(
  ctx: Ctx2D,
  input: CompositionInput,
  width: number,
  height: number,
  scale: number,
): void {
  const bg = input.presentation.background;
  switch (bg.type) {
    case "solid":
      ctx.fillStyle = cssColor(bg.color);
      ctx.fillRect(0, 0, width, height);
      break;
    case "gradient": {
      let gradient: CanvasGradient;
      if (bg.kind === "radial") {
        const c = radialCircle(width, height);
        gradient = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.radius);
      } else {
        const l = linearLine(width, height, bg.angle);
        gradient = ctx.createLinearGradient(l.x0, l.y0, l.x1, l.y1);
      }
      for (const stop of sortedStops(bg.stops))
        gradient.addColorStop(stop.offset, cssColor(stop.color));
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
      break;
    }
    case "mesh": {
      const field = meshFieldSize(width, height);
      const small = makeCanvas(field.width, field.height);
      context2d(small).putImageData(
        new ImageData(renderMeshField(bg, field.width, field.height), field.width, field.height),
        0,
        0,
      );
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(small, 0, 0, width, height);
      ctx.restore();
      break;
    }
    case "image": {
      const image = input.backgroundImage;
      if (!image) {
        ctx.fillStyle = "#F4F4F5";
        ctx.fillRect(0, 0, width, height);
        break;
      }
      if ((bg.blur ?? 0) > 0) {
        ctx.drawImage(
          blurredLayer(image, width, height, bg.fit, 1, bg.blur ?? 0, 1, bg.dim ?? 0),
          0,
          0,
        );
      } else {
        const box = fitBox(sizeOf(image), { width, height }, bg.fit);
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, box.x, box.y, box.width, box.height);
        if ((bg.dim ?? 0) > 0) {
          ctx.fillStyle = `rgba(0, 0, 0, ${String(bg.dim)})`;
          ctx.fillRect(0, 0, width, height);
        }
        ctx.restore();
      }
      break;
    }
    case "source-blur":
      ctx.drawImage(
        blurredLayer(
          input.content,
          width,
          height,
          "cover",
          bg.zoom,
          bg.blur,
          bg.saturation,
          bg.dim,
        ),
        0,
        0,
      );
      break;
    case "shader":
      drawShaderBackground(ctx, bg, width, height, scale, {
        seconds: input.shaderSeconds ?? posterSeconds(bg),
        trustCustomCode: input.trustCustomCode === true,
      });
      break;
    default:
      break;
  }
}

/**
 * Draws the whole composition onto `ctx`, which must be at least `layout.canvas x scale` pixels.
 * `scale` is device pixels per composition pixel (`layout.scale` for an export, less for a preview).
 */
export function drawComposition(
  ctx: Ctx2D,
  input: CompositionInput,
  layout: Layout,
  scale: number = layout.scale,
): void {
  const { presentation } = input;
  const { canvas, unit, contentBox, radius, bar, k } = layout;
  ctx.save();
  ctx.scale(scale, scale);
  drawBackground(ctx, input, canvas.width, canvas.height, scale);

  const { shadow, frame } = presentation;
  if (shadow.enabled && shadow.color.length >= 7) {
    // The shadow of an opaque shape drawn far off the canvas, its shadow offset back onto it: only the
    // shadow lands on the canvas. `shadowBlur` ignores the transform, so it is scaled by hand.
    const away = 100000;
    ctx.save();
    ctx.shadowColor = cssColor(shadow.color);
    ctx.shadowBlur = shadow.blur * scale;
    ctx.shadowOffsetX = (shadow.x + away) * scale;
    ctx.shadowOffsetY = shadow.y * scale;
    ctx.fillStyle = "#000000";
    ctx.beginPath();
    const s = shadow.spread;
    ctx.roundRect(
      unit.x - s - away,
      unit.y - s,
      Math.max(0, unit.width + 2 * s),
      Math.max(0, unit.height + 2 * s),
      Math.max(0, radius + s),
    );
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(unit.x, unit.y, unit.width, unit.height, radius);
  ctx.clip();
  drawFrameChrome(ctx, frame, { x: unit.x, y: unit.y, width: unit.width, bar }, k);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(input.content, contentBox.x, contentBox.y, contentBox.width, contentBox.height);
  ctx.restore();
  ctx.restore();
}

/**
 * The finished picture of a presentation as pixels: `content` is the flat picture (redactions burned
 * in, annotations drawn, crop taken). The size is `layout.output`.
 */
export async function presentImage(
  content: RgbaImage,
  presentation: Presentation,
  layout: Layout,
  backgroundImage: CanvasImageSource | null = null,
): Promise<RgbaImage> {
  await ensureFrameFonts(presentation.frame);
  const picture = makeCanvas(content.width, content.height);
  context2d(picture).putImageData(
    new ImageData(new Uint8ClampedArray(content.data), content.width, content.height),
    0,
    0,
  );
  const out = makeCanvas(layout.output.width, layout.output.height);
  const ctx = context2d(out);
  drawComposition(ctx, { content: picture, presentation, backgroundImage }, layout);
  const { data } = ctx.getImageData(0, 0, out.width, out.height);
  return { width: out.width, height: out.height, data };
}
