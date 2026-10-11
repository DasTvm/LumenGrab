import type { Point, Rect } from "@/document/schema";

/**
 * The editor's view: how the picture sits in the canvas area. `zoom` is screen pixels per image pixel,
 * `x`/`y` is where the image origin is on the screen (CSS pixels, relative to the canvas area). Pure
 * maths, tested in Node.
 */
export interface View {
  zoom: number;
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;
/** Room around the picture when it is fitted into the area. */
export const FIT_MARGIN = 48;

export const clampZoom = (zoom: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

export function toScreen(view: View, p: Point): Point {
  return { x: view.x + p.x * view.zoom, y: view.y + p.y * view.zoom };
}

export function toImage(view: View, p: Point): Point {
  return { x: (p.x - view.x) / view.zoom, y: (p.y - view.y) / view.zoom };
}

/** Fits `content` (an image rectangle) into the area, centred, never larger than 100 %. */
export function fitView(area: Size, content: Rect, margin = FIT_MARGIN): View {
  const availableW = Math.max(1, area.width - 2 * margin);
  const availableH = Math.max(1, area.height - 2 * margin);
  const zoom = clampZoom(Math.min(1, availableW / content.width, availableH / content.height));
  return centerView(area, content, zoom);
}

/** The view that shows `content` centred at `zoom`. */
export function centerView(area: Size, content: Rect, zoom: number): View {
  return {
    zoom,
    x: (area.width - content.width * zoom) / 2 - content.x * zoom,
    y: (area.height - content.height * zoom) / 2 - content.y * zoom,
  };
}

/** Changes the zoom keeping the image point under `anchor` (screen coordinates) where it is. */
export function zoomAt(view: View, anchor: Point, zoom: number): View {
  const next = clampZoom(zoom);
  const image = toImage(view, anchor);
  return { zoom: next, x: anchor.x - image.x * next, y: anchor.y - image.y * next };
}

/** The zoom steps of the + and - buttons. */
export const ZOOM_STEPS: readonly number[] = [
  0.05, 0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16,
];

export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find((s) => s > zoom + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < zoom - 1e-6) ?? MIN_ZOOM;
}

/** Wheel zoom: scroll up = in; a smooth exponential, so a trackpad pinch (ctrl + wheel) feels the same. */
export function wheelZoom(zoom: number, deltaY: number, pinch: boolean): number {
  const speed = pinch ? 0.01 : 0.0015;
  return clampZoom(zoom * Math.exp(-deltaY * speed));
}

/** The label of the zoom control: 40%, 100%, 1,250%. */
export function zoomLabel(zoom: number): string {
  return `${Math.round(zoom * 100).toLocaleString("en-US")}%`;
}
