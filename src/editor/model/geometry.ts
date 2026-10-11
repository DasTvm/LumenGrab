import { isGroup } from "@/document/layers";
import type { Layer, Point, Rect } from "@/document/schema";

/**
 * Pure geometry of the editor, in source-image pixels (AGENTS.md section 4, rule 5): bounds, hit
 * tests, moving and resizing, constraints, crop maths. No DOM, no Konva, so all of it runs in Vitest.
 *
 * Conventions (docs/FORMAT.md "Rendering rules"): `rect`, `ellipse`, `text`, `highlighter`, `spotlight`
 * and `redaction` are boxes with a top-left corner; `rect`, `ellipse` and `text` may be rotated
 * clockwise by `rotation` degrees around the centre of their box. A `counter` is a circle with its
 * centre at `x, y` and a diameter of `size`.
 */

export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: readonly Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const DIRECTION: Record<Handle, readonly [number, number]> = {
  nw: [-1, -1],
  n: [0, -1],
  ne: [1, -1],
  e: [1, 0],
  se: [1, 1],
  s: [0, 1],
  sw: [-1, 1],
  w: [-1, 0],
};

/** Layers that have a box the user can resize with the eight handles. */
export function hasBox(layer: Layer): boolean {
  return ["rect", "ellipse", "text", "highlighter", "spotlight", "redaction"].includes(layer.type);
}

export function canRotate(layer: Layer): boolean {
  return ["rect", "ellipse", "text"].includes(layer.type);
}

// ---- small helpers ------------------------------------------------------------------------------

export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function rectContains(r: Rect, p: Point, margin = 0): boolean {
  return (
    p.x >= r.x - margin &&
    p.x <= r.x + r.width + margin &&
    p.y >= r.y - margin &&
    p.y <= r.y + r.height + margin
  );
}

export function growRect(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  const first = rects[0];
  if (!first) return null;
  let x0 = first.x;
  let y0 = first.y;
  let x1 = first.x + first.width;
  let y1 = first.y + first.height;
  for (const r of rects) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.width);
    y1 = Math.max(y1, r.y + r.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function rotatePoint(p: Point, around: Point, degrees: number): Point {
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const dx = p.x - around.x;
  const dy = p.y - around.y;
  return { x: around.x + dx * cos - dy * sin, y: around.y + dx * sin + dy * cos };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** The pencil's flat `[x0, y0, ...]` array as points. */
export function pointsOf(flat: readonly number[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2)
    points.push({ x: flat[i] ?? 0, y: flat[i + 1] ?? 0 });
  return points;
}

// ---- arrows and lines ---------------------------------------------------------------------------

type Stroke = Layer & { from: Point; to: Point; curve?: Point; style?: string; width: number };

/**
 * The control point of a curved arrow: the stored `curve`, or by default a point half way along
 * the arrow, pushed sideways by a fifth of its length. The curve is a quadratic Bézier from `from`
 * through that control point to `to` (docs/FORMAT.md "Rendering rules").
 */
export function arrowControl(layer: Pick<Stroke, "from" | "to" | "curve">): Point {
  if (layer.curve) return layer.curve;
  const mid = { x: (layer.from.x + layer.to.x) / 2, y: (layer.from.y + layer.to.y) / 2 };
  const dx = layer.to.x - layer.from.x;
  const dy = layer.to.y - layer.from.y;
  return { x: mid.x - dy * 0.2, y: mid.y + dx * 0.2 };
}

/** A quadratic Bézier as a polyline. */
export function curvePoints(from: Point, control: Point, to: Point, steps = 24): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    points.push({
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    });
  }
  return points;
}

/** The centre line of an arrow or a line as a polyline. */
export function strokePoints(layer: Layer): Point[] {
  const s = layer as Stroke;
  if (layer.type === "arrow" && s.style === "curved") {
    return curvePoints(s.from, arrowControl(s), s.to);
  }
  return [s.from, s.to];
}

// ---- boxes and bounds ---------------------------------------------------------------------------

/** Text has no stored height. Until the drawing code measures it, the editor uses this estimate. */
export interface TextSize {
  width: number;
  height: number;
}
export type MeasureText = (layer: Layer) => TextSize;

export const estimateText: MeasureText = (layer) => {
  const size = Number(layer["size"]) || 16;
  const lines = (typeof layer["text"] === "string" ? layer["text"] : "").split("\n");
  const longest = lines.reduce((n, line) => Math.max(n, line.length), 1);
  const fixed = layer["width"];
  return {
    width: typeof fixed === "number" ? fixed : longest * size * 0.56,
    height: lines.length * size * 1.3,
  };
};

/** The unrotated box of a layer that has one (see `hasBox`), a counter's circle, or the box around a stroke. */
export function layerBox(layer: Layer, measure: MeasureText = estimateText): Rect | null {
  switch (layer.type) {
    case "rect":
    case "ellipse":
      return {
        x: n(layer, "x"),
        y: n(layer, "y"),
        width: n(layer, "width"),
        height: n(layer, "height"),
      };
    case "text": {
      const { width, height } = measure(layer);
      return { x: n(layer, "x"), y: n(layer, "y"), width, height };
    }
    case "highlighter":
    case "spotlight":
    case "redaction": {
      const r = layer["rect"] as Rect;
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }
    case "counter": {
      const d = n(layer, "size");
      return { x: n(layer, "x") - d / 2, y: n(layer, "y") - d / 2, width: d, height: d };
    }
    case "arrow":
    case "line":
    case "pencil": {
      const pts =
        layer.type === "pencil" ? pointsOf(layer["points"] as number[]) : strokePoints(layer);
      return unionRects(pts.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })));
    }
    case "group":
      return null;
    default:
      return null;
  }
}

function n(layer: Layer, key: string): number {
  const v = layer[key];
  return typeof v === "number" ? v : 0;
}

/** How far the drawn layer reaches beyond its box (stroke, arrow head). */
function reach(layer: Layer): number {
  switch (layer.type) {
    case "rect":
    case "ellipse":
      return n(layer, "strokeWidth") / 2;
    case "arrow":
      return Math.max(n(layer, "width") * 3, 6);
    case "line":
    case "pencil":
      return n(layer, "width") / 2;
    default:
      return 0;
  }
}

/** The box of a layer with its rotation applied: the smallest axis-aligned rectangle that holds it. */
export function layerBounds(layer: Layer, measure: MeasureText = estimateText): Rect | null {
  if (isGroup(layer)) {
    return unionRects(
      layer.layers.map((l) => layerBounds(l, measure)).filter((r): r is Rect => r !== null),
    );
  }
  const box = layerBox(layer, measure);
  if (!box) return null;
  const grown = growRect(box, reach(layer));
  const rotation = canRotate(layer) ? n(layer, "rotation") : 0;
  if (rotation === 0) return grown;
  const c = rectCenter(grown);
  const corners = [
    { x: grown.x, y: grown.y },
    { x: grown.x + grown.width, y: grown.y },
    { x: grown.x + grown.width, y: grown.y + grown.height },
    { x: grown.x, y: grown.y + grown.height },
  ].map((p) => rotatePoint(p, c, rotation));
  return unionRects(corners.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })));
}

/** The bounds of several layers together. */
export function boundsOf(layers: readonly Layer[], measure?: MeasureText): Rect | null {
  return unionRects(
    layers.map((l) => layerBounds(l, measure)).filter((r): r is Rect => r !== null),
  );
}

// ---- hit testing --------------------------------------------------------------------------------

/**
 * Whether `p` is on the layer. `tolerance` is the reach of the pointer in image pixels (the caller
 * divides its screen pixels by the zoom). Hidden and locked layers are never hit. A group is hit
 * where one of its children is.
 */
export function hitLayer(
  layer: Layer,
  p: Point,
  tolerance: number,
  measure?: MeasureText,
): boolean {
  if (layer.visible === false || layer.locked === true) return false;
  if (isGroup(layer)) return layer.layers.some((l) => hitLayer(l, p, tolerance, measure));
  const box = layerBox(layer, measure);
  if (!box) return false;
  switch (layer.type) {
    case "rect": {
      const q = unrotate(layer, box, p);
      const half = n(layer, "strokeWidth") / 2;
      const filled = layer["fill"] !== null && layer["fill"] !== undefined;
      if (filled) return rectContains(box, q, half + tolerance);
      return (
        rectContains(box, q, half + tolerance) &&
        !rectContains(growRect(box, -(half + tolerance)), q)
      );
    }
    case "ellipse": {
      const q = unrotate(layer, box, p);
      const half = n(layer, "strokeWidth") / 2 + tolerance;
      const c = rectCenter(box);
      const inEllipse = (grow: number) => {
        const a = box.width / 2 + grow;
        const b = box.height / 2 + grow;
        if (a <= 0 || b <= 0) return false;
        return ((q.x - c.x) / a) ** 2 + ((q.y - c.y) / b) ** 2 <= 1;
      };
      const filled = layer["fill"] !== null && layer["fill"] !== undefined;
      return filled ? inEllipse(half) : inEllipse(half) && !inEllipse(-half);
    }
    case "text":
      return rectContains(box, unrotate(layer, box, p), tolerance);
    case "highlighter":
    case "redaction":
      return rectContains(box, p, tolerance);
    case "spotlight": {
      if (layer["shape"] !== "ellipse") return rectContains(box, p, tolerance);
      const c = rectCenter(box);
      const a = box.width / 2 + tolerance;
      const b = box.height / 2 + tolerance;
      return ((p.x - c.x) / a) ** 2 + ((p.y - c.y) / b) ** 2 <= 1;
    }
    case "counter":
      return (
        distance(p, { x: n(layer, "x"), y: n(layer, "y") }) <= n(layer, "size") / 2 + tolerance
      );
    case "arrow":
    case "line": {
      const pts = strokePoints(layer);
      const slack = Math.max(n(layer, "width") / 2, layer.type === "arrow" ? 3 : 0) + tolerance;
      return pts.some((a, i) => {
        const b = pts[i + 1];
        return b !== undefined && distanceToSegment(p, a, b) <= slack;
      });
    }
    case "pencil": {
      const pts = pointsOf(layer["points"] as number[]);
      const slack = n(layer, "width") / 2 + tolerance;
      if (pts.length === 1) return distance(p, pts[0] as Point) <= slack;
      return pts.some((a, i) => {
        const b = pts[i + 1];
        return b !== undefined && distanceToSegment(p, a, b) <= slack;
      });
    }
    default:
      return false;
  }
}

function unrotate(layer: Layer, box: Rect, p: Point): Point {
  const rotation = canRotate(layer) ? n(layer, "rotation") : 0;
  return rotation === 0 ? p : rotatePoint(p, rectCenter(box), -rotation);
}

/**
 * The id of the layer under the pointer, topmost first. A group counts as one layer (its id is
 * returned) unless `enterGroups` is set, which returns the child instead.
 */
export function hitTest(
  layers: readonly Layer[],
  p: Point,
  tolerance: number,
  options: { enterGroups?: boolean; measure?: MeasureText } = {},
): string | null {
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i];
    if (!layer || !hitLayer(layer, p, tolerance, options.measure)) continue;
    if (options.enterGroups && isGroup(layer)) {
      return hitTest(layer.layers, p, tolerance, options) ?? layer.id;
    }
    return layer.id;
  }
  return null;
}

// ---- moving and resizing ------------------------------------------------------------------------

/** Moves a layer (a group moves everything inside it). Works on a draft. */
export function translateLayer(layer: Layer, dx: number, dy: number): void {
  switch (layer.type) {
    case "rect":
    case "ellipse":
    case "text":
    case "counter":
      layer["x"] = n(layer, "x") + dx;
      layer["y"] = n(layer, "y") + dy;
      return;
    case "highlighter":
    case "spotlight":
    case "redaction": {
      const r = layer["rect"] as Rect;
      r.x += dx;
      r.y += dy;
      return;
    }
    case "arrow":
    case "line": {
      const s = layer as Stroke;
      s.from.x += dx;
      s.from.y += dy;
      s.to.x += dx;
      s.to.y += dy;
      if (s.curve) {
        s.curve.x += dx;
        s.curve.y += dy;
      }
      return;
    }
    case "pencil": {
      const pts = layer["points"] as number[];
      for (let i = 0; i + 1 < pts.length; i += 2) {
        pts[i] = (pts[i] ?? 0) + dx;
        pts[i + 1] = (pts[i + 1] ?? 0) + dy;
      }
      return;
    }
    case "group":
      if (isGroup(layer)) for (const child of layer.layers) translateLayer(child, dx, dy);
      return;
    default:
      return;
  }
}

/** Writes a box back into a layer that has one. A text layer keeps its own height (it grows with its text). */
export function applyBox(layer: Layer, box: Rect): void {
  switch (layer.type) {
    case "rect":
    case "ellipse":
      layer["x"] = box.x;
      layer["y"] = box.y;
      layer["width"] = box.width;
      layer["height"] = box.height;
      return;
    case "text":
      layer["x"] = box.x;
      layer["y"] = box.y;
      layer["width"] = box.width;
      return;
    case "highlighter":
    case "spotlight":
    case "redaction": {
      const r = layer["rect"] as Rect;
      r.x = box.x;
      r.y = box.y;
      r.width = box.width;
      r.height = box.height;
      return;
    }
    default:
      return;
  }
}

export interface ResizeOptions {
  /** Keep the aspect ratio (Shift, corner handles). */
  keepAspect?: boolean;
  /** Resize around the centre (Alt). */
  fromCenter?: boolean;
  /** Smallest width and height. */
  min?: number;
  /** Rotation of the box in degrees, clockwise, around its centre. */
  rotation?: number;
}

/**
 * The box after dragging `handle` to the image point `pointer`. The opposite handle (or the centre
 * with `fromCenter`) stays where it is on the screen, also for a rotated box. A box never flips: it
 * stops at the minimum size.
 */
export function resizeBox(
  box: Rect,
  handle: Handle,
  pointer: Point,
  options: ResizeOptions = {},
): Rect {
  const [hx, hy] = DIRECTION[handle];
  const min = options.min ?? 1;
  const rotation = options.rotation ?? 0;
  const center = rectCenter(box);
  const anchorLocal = options.fromCenter
    ? { x: 0, y: 0 }
    : { x: (-hx * box.width) / 2, y: (-hy * box.height) / 2 };
  const anchor = rotatePoint(
    { x: center.x + anchorLocal.x, y: center.y + anchorLocal.y },
    center,
    rotation,
  );
  const local = rotatePoint(pointer, anchor, -rotation);
  const grow = options.fromCenter ? 2 : 1;
  const dx = local.x - anchor.x;
  const dy = local.y - anchor.y;
  let width = hx === 0 ? box.width : Math.max(min, grow * hx * dx);
  let height = hy === 0 ? box.height : Math.max(min, grow * hy * dy);
  if (options.keepAspect && hx !== 0 && hy !== 0 && box.width > 0 && box.height > 0) {
    const scale = Math.max(width / box.width, height / box.height);
    width = Math.max(min, box.width * scale);
    height = Math.max(min, box.height * scale);
  }
  const newCenter = options.fromCenter
    ? center
    : rotatePoint(
        { x: anchor.x + (hx * width) / 2, y: anchor.y + (hy * height) / 2 },
        anchor,
        rotation,
      );
  return { x: newCenter.x - width / 2, y: newCenter.y - height / 2, width, height };
}

/** The angle (degrees, clockwise from "up") of the pointer around the centre, for the rotate handle. */
export function angleAround(center: Point, pointer: Point): number {
  return (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI + 90;
}

/** Rounds to `step` degrees and normalises to -180..180. */
export function snapAngle(degrees: number, step: number): number {
  const snapped = Math.round(degrees / step) * step;
  return ((((snapped + 180) % 360) + 360) % 360) - 180;
}

// ---- drawing constraints ------------------------------------------------------------------------

/** Shift while drawing a line or arrow: the end point snaps to the nearest multiple of `step` degrees. */
export function constrainAngle(from: Point, to: Point, step = 45): Point {
  const length = distance(from, to);
  if (length === 0) return to;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const snapped = Math.round(angle / ((step * Math.PI) / 180)) * ((step * Math.PI) / 180);
  return { x: from.x + length * Math.cos(snapped), y: from.y + length * Math.sin(snapped) };
}

/** Shift while drawing a box: the end point moves so both sides are equally long. */
export function constrainSquare(from: Point, to: Point): Point {
  const side = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
  return {
    x: from.x + (to.x < from.x ? -side : side),
    y: from.y + (to.y < from.y ? -side : side),
  };
}

/** The counter the next click places: one more than the highest number in the document, hidden ones included. */
export function nextCounterValue(layers: readonly Layer[]): number {
  let highest = 0;
  const visit = (list: readonly Layer[]) => {
    for (const layer of list) {
      if (layer.type === "counter") highest = Math.max(highest, n(layer, "value"));
      if (isGroup(layer)) visit(layer.layers);
    }
  };
  visit(layers);
  return highest + 1;
}

/** Pulls `value` to the nearest target if it is within `threshold` (snapping to the edges of the picture). */
export function snapValue(value: number, targets: readonly number[], threshold: number): number {
  let best = value;
  let bestDistance = threshold;
  for (const target of targets) {
    const d = Math.abs(target - value);
    if (d <= bestDistance) {
      best = target;
      bestDistance = d;
    }
  }
  return best;
}

// ---- crop ---------------------------------------------------------------------------------------

export interface Size {
  width: number;
  height: number;
}

/** Keeps a rectangle inside the picture, shrinking it if it is bigger, never below `min`. */
export function clampRect(r: Rect, bounds: Size, min = 1): Rect {
  const width = Math.max(min, Math.min(r.width, bounds.width));
  const height = Math.max(min, Math.min(r.height, bounds.height));
  return {
    x: Math.max(0, Math.min(r.x, bounds.width - width)),
    y: Math.max(0, Math.min(r.y, bounds.height - height)),
    width,
    height,
  };
}

/** The largest centred rectangle of the given ratio (`width / height`) inside a size. */
export function fitAspect(size: Size, ratio: number): Rect {
  let width = size.width;
  let height = width / ratio;
  if (height > size.height) {
    height = size.height;
    width = height * ratio;
  }
  return { x: (size.width - width) / 2, y: (size.height - height) / 2, width, height };
}

/**
 * The crop rectangle after dragging a handle, kept inside the picture. With `ratio` the aspect is
 * locked (edge handles then grow the other side around the middle of the crop).
 */
export function resizeCrop(
  crop: Rect,
  handle: Handle,
  pointer: Point,
  image: Size,
  ratio: number | null = null,
  min = 8,
): Rect {
  const [hx, hy] = DIRECTION[handle];
  // Work with the four edges; the dragged ones follow the pointer inside the picture.
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;
  const px = Math.max(0, Math.min(image.width, pointer.x));
  const py = Math.max(0, Math.min(image.height, pointer.y));
  if (hx === -1) left = Math.min(px, right - min);
  if (hx === 1) right = Math.max(px, left + min);
  if (hy === -1) top = Math.min(py, bottom - min);
  if (hy === 1) bottom = Math.max(py, top + min);
  if (ratio === null) return { x: left, y: top, width: right - left, height: bottom - top };

  let width = right - left;
  let height = bottom - top;
  if (hx !== 0 && hy !== 0) {
    // Corner: the side that moved more decides; the opposite corner stays.
    if (width / ratio > height) height = width / ratio;
    else width = height * ratio;
  } else if (hx !== 0) {
    height = width / ratio;
  } else {
    width = height * ratio;
  }
  // Anchor: the corner or edge opposite the handle (the middle of the free axis for an edge handle).
  const anchorX = hx === 1 ? left : hx === -1 ? right : crop.x + crop.width / 2;
  const anchorY = hy === 1 ? top : hy === -1 ? bottom : crop.y + crop.height / 2;
  // The largest size that still fits in the picture from that anchor.
  const roomX =
    hx === 1
      ? image.width - anchorX
      : hx === -1
        ? anchorX
        : 2 * Math.min(anchorX, image.width - anchorX);
  const roomY =
    hy === 1
      ? image.height - anchorY
      : hy === -1
        ? anchorY
        : 2 * Math.min(anchorY, image.height - anchorY);
  const shrink = Math.min(1, roomX / width, roomY / height);
  width *= shrink;
  height *= shrink;
  const x = hx === 1 ? anchorX : hx === -1 ? anchorX - width : anchorX - width / 2;
  const y = hy === 1 ? anchorY : hy === -1 ? anchorY - height : anchorY - height / 2;
  return { x, y, width, height };
}
