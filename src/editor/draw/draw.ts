import { isGroup } from "@/document/layers";
import type { Layer, Point, Rect } from "@/document/schema";
import { pointsOf, smoothPoints } from "../model/geometry";
import { arrowShape } from "./arrow";
import { contrastColor, cssColor } from "./color";
import { BACKGROUND_PADDING, fontString, layoutText, LINE_HEIGHT } from "./text";

/**
 * The one drawing code of the editor and of every export (docs/FORMAT.md "Rendering rules"). Everything
 * is in source-image pixels. The editor draws each layer through this (Konva only adds hit testing and
 * handles); the preview, the export and the clipboard call it on an OffscreenCanvas, so what you see is
 * what you export.
 *
 * Redactions are NOT drawn here: they destroy pixels (`document/render/pixels.ts`) before anything
 * is drawn, and are never an overlay. Layers of a type this version does not know are skipped.
 */
export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface DrawEnv {
  /** Size of the whole source image: a spotlight dims all of it. */
  width: number;
  height: number;
}

function box(layer: Layer, key: string): number {
  const v = layer[key];
  return typeof v === "number" ? v : 0;
}
function str(layer: Layer, key: string, fallback = ""): string {
  const v = layer[key];
  return typeof v === "string" ? v : fallback;
}

/** Draws layers bottom to top. Hidden layers and groups are skipped with everything inside. */
export function drawLayers(ctx: Ctx2D, layers: readonly Layer[], env: DrawEnv): void {
  for (const layer of layers) drawLayer(ctx, layer, env);
}

export function drawLayer(ctx: Ctx2D, layer: Layer, env: DrawEnv): void {
  if (layer.visible === false) return;
  ctx.save();
  try {
    switch (layer.type) {
      case "group":
        if (isGroup(layer)) drawLayers(ctx, layer.layers, env);
        break;
      case "rect":
        drawRect(ctx, layer);
        break;
      case "ellipse":
        drawEllipse(ctx, layer);
        break;
      case "line":
        drawLine(ctx, layer);
        break;
      case "arrow":
        drawArrow(ctx, layer);
        break;
      case "text":
        drawText(ctx, layer);
        break;
      case "counter":
        drawCounter(ctx, layer);
        break;
      case "pencil":
        drawPencil(ctx, layer);
        break;
      case "highlighter":
        drawHighlighter(ctx, layer);
        break;
      case "spotlight":
        drawSpotlight(ctx, layer, env);
        break;
      default:
        break; // redaction (baked into the pixels), or a type from a newer version
    }
  } finally {
    ctx.restore();
  }
}

// ---- shapes -------------------------------------------------------------------------------------

/** Rotation is clockwise, around the centre of the layer's box. */
function rotateAroundCenter(ctx: Ctx2D, layer: Layer, x: number, y: number, w: number, h: number) {
  const rotation = box(layer, "rotation");
  if (rotation === 0) return;
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-(x + w / 2), -(y + h / 2));
}

function fillAndStroke(ctx: Ctx2D, layer: Layer) {
  const fill = layer["fill"];
  const stroke = layer["stroke"];
  const strokeWidth = box(layer, "strokeWidth");
  if (typeof fill === "string") {
    ctx.fillStyle = cssColor(fill);
    ctx.fill();
  }
  if (typeof stroke === "string" && strokeWidth > 0) {
    ctx.strokeStyle = cssColor(stroke);
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}

function drawRect(ctx: Ctx2D, layer: Layer) {
  const [x, y, w, h] = [
    box(layer, "x"),
    box(layer, "y"),
    box(layer, "width"),
    box(layer, "height"),
  ];
  const radius = Math.max(0, Math.min(box(layer, "radius"), w / 2, h / 2));
  rotateAroundCenter(ctx, layer, x, y, w, h);
  ctx.beginPath();
  if (radius > 0) {
    ctx.roundRect(x, y, w, h, radius);
    ctx.lineJoin = "round";
  } else {
    ctx.rect(x, y, w, h);
    ctx.lineJoin = "miter";
  }
  fillAndStroke(ctx, layer);
}

function drawEllipse(ctx: Ctx2D, layer: Layer) {
  const [x, y, w, h] = [
    box(layer, "x"),
    box(layer, "y"),
    box(layer, "width"),
    box(layer, "height"),
  ];
  rotateAroundCenter(ctx, layer, x, y, w, h);
  ctx.beginPath();
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  fillAndStroke(ctx, layer);
}

function strokeStyle(ctx: Ctx2D, color: string, width: number) {
  ctx.strokeStyle = cssColor(color);
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
}

function drawLine(ctx: Ctx2D, layer: Layer) {
  const from = layer["from"] as Point;
  const to = layer["to"] as Point;
  strokeStyle(ctx, str(layer, "color", "#000000"), box(layer, "width"));
  const dash = layer["dash"];
  if (Array.isArray(dash) && dash.length > 0) ctx.setLineDash(dash as number[]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function drawArrow(ctx: Ctx2D, layer: Layer) {
  const width = box(layer, "width");
  const color = str(layer, "color", "#000000");
  const shape = arrowShape({
    from: layer["from"] as Point,
    to: layer["to"] as Point,
    style: str(layer, "style", "straight"),
    width,
    curve: layer["curve"] as Point | undefined,
  });
  strokeStyle(ctx, color, width);
  ctx.beginPath();
  ctx.moveTo(shape.shaft.from.x, shape.shaft.from.y);
  const { control, to } = shape.shaft;
  if (control) ctx.quadraticCurveTo(control.x, control.y, to.x, to.y);
  else ctx.lineTo(to.x, to.y);
  ctx.stroke();
  for (const head of shape.heads) {
    ctx.beginPath();
    ctx.moveTo(head.tip.x, head.tip.y);
    ctx.lineTo(head.left.x, head.left.y);
    ctx.lineTo(head.right.x, head.right.y);
    ctx.closePath();
    if (shape.outlined) {
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.fillStyle = cssColor(color);
      ctx.fill();
      ctx.stroke(); // round joins soften the corners like the shaft's caps
    }
  }
}

// ---- text, counter ------------------------------------------------------------------------------

function setFont(ctx: Ctx2D, layer: Layer) {
  ctx.font = fontString(
    str(layer, "fontId", "inter"),
    box(layer, "weight") || 400,
    box(layer, "size"),
  );
}

/** Lays a text layer out with the font it will be drawn in. */
export function layoutTextLayer(ctx: Ctx2D, layer: Layer) {
  setFont(ctx, layer);
  const width = layer["width"];
  return layoutText(
    {
      text: str(layer, "text"),
      width: typeof width === "number" ? width : null,
      size: box(layer, "size"),
      align: str(layer, "align", "left"),
    },
    (s) => ctx.measureText(s).width,
  );
}

function drawText(ctx: Ctx2D, layer: Layer) {
  const [x, y, size] = [box(layer, "x"), box(layer, "y"), box(layer, "size")];
  const layout = layoutTextLayer(ctx, layer);
  rotateAroundCenter(ctx, layer, x, y, layout.width, layout.height);
  const background = layer["background"];
  if (typeof background === "string") {
    const pad = size * BACKGROUND_PADDING;
    ctx.fillStyle = cssColor(background);
    ctx.fillRect(x - pad, y - pad, layout.width + 2 * pad, layout.height + 2 * pad);
  }
  setFont(ctx, layer);
  ctx.fillStyle = cssColor(str(layer, "color", "#000000"));
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  layout.lines.forEach((line, i) => {
    ctx.fillText(line.text, x + line.offset, y + size * LINE_HEIGHT * (i + 0.5));
  });
}

/** The digits of a counter shrink so 2 and 3 digits still fit the circle. */
export function counterFontSize(diameter: number, digits: number): number {
  return diameter * (digits <= 1 ? 0.55 : digits === 2 ? 0.45 : 0.36);
}

function drawCounter(ctx: Ctx2D, layer: Layer) {
  const [x, y, d] = [box(layer, "x"), box(layer, "y"), box(layer, "size")];
  const color = str(layer, "color", "#EF4444");
  ctx.beginPath();
  ctx.arc(x, y, d / 2, 0, Math.PI * 2);
  ctx.fillStyle = cssColor(color);
  ctx.fill();
  const label = String(box(layer, "value"));
  ctx.font = fontString("inter", 700, counterFontSize(d, label.length));
  ctx.fillStyle = contrastColor(color);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, x, y + d * 0.03);
}

// ---- marks --------------------------------------------------------------------------------------

function drawPencil(ctx: Ctx2D, layer: Layer) {
  const width = box(layer, "width");
  const color = str(layer, "color", "#000000");
  const points = smoothPoints(pointsOf(layer["points"] as number[]), box(layer, "smoothing"));
  const first = points[0];
  if (!first) return;
  if (points.length === 1) {
    ctx.beginPath();
    ctx.arc(first.x, first.y, width / 2, 0, Math.PI * 2);
    ctx.fillStyle = cssColor(color);
    ctx.fill();
    return;
  }
  strokeStyle(ctx, color, width);
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  if (points.length === 2) {
    const second = points[1] as Point;
    ctx.lineTo(second.x, second.y);
  } else {
    // Curve through the middles of the segments, with the points as control points.
    for (let i = 1; i < points.length - 1; i += 1) {
      const p = points[i] as Point;
      const next = points[i + 1] as Point;
      ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
    }
    const last = points[points.length - 1] as Point;
    ctx.lineTo(last.x, last.y);
  }
  ctx.stroke();
}

function drawHighlighter(ctx: Ctx2D, layer: Layer) {
  const r = layer["rect"] as Rect;
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = cssColor(str(layer, "color", "#FDE047"), box(layer, "opacity"));
  ctx.fillRect(r.x, r.y, r.width, r.height);
}

function drawSpotlight(ctx: Ctx2D, layer: Layer, env: DrawEnv) {
  const r = layer["rect"] as Rect;
  ctx.beginPath();
  ctx.rect(0, 0, env.width, env.height);
  if (layer["shape"] === "ellipse") {
    ctx.moveTo(r.x + r.width, r.y + r.height / 2);
    ctx.ellipse(
      r.x + r.width / 2,
      r.y + r.height / 2,
      r.width / 2,
      r.height / 2,
      0,
      0,
      Math.PI * 2,
    );
  } else {
    ctx.rect(r.x, r.y, r.width, r.height);
  }
  ctx.fillStyle = `rgba(0, 0, 0, ${String(box(layer, "dimOpacity"))})`;
  ctx.fill("evenodd");
}
