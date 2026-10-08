/**
 * Selection geometry for the capture overlay. Pure functions, unit tested, no DOM.
 *
 * Two coordinate spaces: CSS pixels (pointer events, drawing) and frame pixels (what is captured).
 * Their ratio is derived from the real sizes (image pixels / window CSS size), never from a
 * guessed devicePixelRatio, so fractional DPI scales and rounding stay exact.
 */

import type { PixelRect } from "@/platform";

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Point, Size {}

/** Selections smaller than this (CSS px, either edge) are ignored as accidental clicks. */
export const MIN_SELECTION_CSS_PX = 5;

/** The rectangle spanned by two corners, whichever direction the user dragged. */
export function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function clampPoint(p: Point, bounds: Size): Point {
  return {
    x: Math.min(Math.max(p.x, 0), bounds.width),
    y: Math.min(Math.max(p.y, 0), bounds.height),
  };
}

export function isSelectionBigEnough(r: Rect): boolean {
  return r.width >= MIN_SELECTION_CSS_PX && r.height >= MIN_SELECTION_CSS_PX;
}

/** CSS pixel rectangle -> frame pixel rectangle: edges rounded to the nearest pixel, clamped to the frame. */
export function cssRectToPixelRect(r: Rect, css: Size, px: Size): PixelRect {
  const sx = px.width / css.width;
  const sy = px.height / css.height;
  const x0 = clamp(Math.round(r.x * sx), 0, px.width);
  const y0 = clamp(Math.round(r.y * sy), 0, px.height);
  const x1 = clamp(Math.round((r.x + r.width) * sx), 0, px.width);
  const y1 = clamp(Math.round((r.y + r.height) * sy), 0, px.height);
  return { x: x0, y: y0, width: Math.max(x1 - x0, 0), height: Math.max(y1 - y0, 0) };
}

/** Frame pixel rectangle -> CSS pixel rectangle (for drawing window highlights). */
export function pixelRectToCssRect(r: PixelRect, css: Size, px: Size): Rect {
  const sx = css.width / px.width;
  const sy = css.height / px.height;
  return { x: r.x * sx, y: r.y * sy, width: r.width * sx, height: r.height * sy };
}

export function cssPointToPixelPoint(p: Point, css: Size, px: Size): Point {
  return { x: (p.x * px.width) / css.width, y: (p.y * px.height) / css.height };
}

/** The frontmost window under a point. `windows` must be ordered front to back. */
export function hitTestWindow<W extends PixelRect>(windows: readonly W[], p: Point): W | undefined {
  return windows.find(
    (w) => p.x >= w.x && p.y >= w.y && p.x < w.x + w.width && p.y < w.y + w.height,
  );
}

/** How far a rectangle may move by (dx, dy) and still stay inside `bounds` (used for Space-to-move). */
export function clampTranslation(r: Rect, dx: number, dy: number, bounds: Size): Point {
  return {
    x: clamp(dx, -r.x, bounds.width - (r.x + r.width)),
    y: clamp(dy, -r.y, bounds.height - (r.y + r.height)),
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}
