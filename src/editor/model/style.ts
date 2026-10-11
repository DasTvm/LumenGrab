import type { Layer, Point, Rect } from "@/document/schema";
import { dashFor, type ToolOptions } from "../ui/tools";
import { normalizeRect } from "./geometry";

/**
 * New layers from the tool options, and the mapping between the panel's controls and the numbers in the
 * file. Pure, tested in Node.
 */
const base = (id: string) => ({ id, visible: true, locked: false });

export function newBox(
  kind: "rect" | "ellipse",
  id: string,
  box: Rect,
  options: ToolOptions["rect"] | ToolOptions["ellipse"],
): Layer {
  const common = {
    ...base(id),
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    stroke: options.stroke,
    fill: options.fill,
    strokeWidth: options.strokeWidth,
  };
  return kind === "rect"
    ? { ...common, type: "rect", radius: (options as ToolOptions["rect"]).radius }
    : { ...common, type: "ellipse" };
}

export function newLine(id: string, from: Point, to: Point, o: ToolOptions["line"]): Layer {
  return {
    ...base(id),
    type: "line",
    from,
    to,
    color: o.color,
    width: o.width,
    ...(o.dashed ? { dash: dashFor(o.width) } : {}),
  };
}

export function newArrow(id: string, from: Point, to: Point, o: ToolOptions["arrow"]): Layer {
  return { ...base(id), type: "arrow", from, to, style: o.style, color: o.color, width: o.width };
}

export function newPencil(id: string, start: Point, o: ToolOptions["pencil"]): Layer {
  return {
    ...base(id),
    type: "pencil",
    points: [start.x, start.y],
    color: o.color,
    width: o.width,
    smoothing: o.smoothing,
  };
}

export function newHighlighter(id: string, box: Rect, o: ToolOptions["highlighter"]): Layer {
  return { ...base(id), type: "highlighter", rect: { ...box }, color: o.color, opacity: o.opacity };
}

export function newSpotlight(id: string, box: Rect, o: ToolOptions["spotlight"]): Layer {
  return {
    ...base(id),
    type: "spotlight",
    rect: { ...box },
    shape: o.shape,
    dimOpacity: o.dimOpacity,
  };
}

export function newRedaction(id: string, box: Rect, o: ToolOptions["redact"], seed: number): Layer {
  return {
    ...base(id),
    type: "redaction",
    mode: o.mode,
    rect: { ...box },
    strength: o.mode === "solid" ? 0 : redactStrengthPx(o.mode, o.strength),
    ...(o.mode === "solid" ? { color: o.color } : {}),
    seed,
  };
}

export function newCounter(id: string, at: Point, value: number, o: ToolOptions["counter"]): Layer {
  return { ...base(id), type: "counter", x: at.x, y: at.y, value, color: o.color, size: o.size };
}

export function newText(id: string, at: Point, o: ToolOptions["text"]): Layer {
  return {
    ...base(id),
    type: "text",
    x: at.x,
    y: at.y,
    width: null,
    text: "",
    fontId: o.fontId,
    size: o.size,
    weight: o.weight,
    color: o.color,
    background: o.background,
    align: o.align,
    rotation: 0,
  };
}

/** The box between two points, or a square / centred box with the modifiers. */
export function dragBox(
  from: Point,
  to: Point,
  options: { square?: boolean; center?: boolean },
): Rect {
  let end = to;
  if (options.square) {
    const side = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
    end = {
      x: from.x + (to.x < from.x ? -side : side),
      y: from.y + (to.y < from.y ? -side : side),
    };
  }
  if (options.center) {
    const dx = end.x - from.x;
    const dy = end.y - from.y;
    return normalizeRect({ x: from.x - dx, y: from.y - dy }, end);
  }
  return normalizeRect(from, end);
}

// ---- redaction strength: the panel says 0-100 %, the file stores pixels -----------------------------

/** Blur radius 4..40 px, pixelate block 4..48 px for 0..100 %. */
const RANGE = { blur: [4, 40], pixelate: [4, 48] } as const;

export function redactStrengthPx(mode: "blur" | "pixelate", percent: number): number {
  const [lo, hi] = RANGE[mode];
  // Hundredths of a pixel keep the percentage stable when it is read back; the renderer rounds anyway.
  return Math.round((lo + (Math.max(0, Math.min(100, percent)) / 100) * (hi - lo)) * 100) / 100;
}

export function redactStrengthPercent(mode: "blur" | "pixelate", px: number): number {
  const [lo, hi] = RANGE[mode];
  return Math.round(Math.max(0, Math.min(1, (px - lo) / (hi - lo))) * 100);
}
