import type { Presentation } from "@/document/schema";

type Background = Presentation["background"];
export type GradientBackground = Extract<Background, { type: "gradient" }>;

export interface Line {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The line of a linear gradient on a `width` x `height` canvas, by the CSS rule: 0° points up and the
 * angle turns clockwise; the line runs through the centre and is as long as the gradient has to be for
 * the corners to get the first and the last colour (docs/FORMAT.md section 4b).
 */
export function linearLine(width: number, height: number, angle: number): Line {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const cx = width / 2;
  const cy = height / 2;
  return { x0: cx - dx * half, y0: cy - dy * half, x1: cx + dx * half, y1: cy + dy * half };
}

/** A radial gradient is a circle around the centre that reaches the farthest corner. */
export function radialCircle(width: number, height: number) {
  return { x: width / 2, y: height / 2, radius: Math.hypot(width / 2, height / 2) };
}

/** The stops by offset (stable for equal offsets), as the canvas wants them. */
export function sortedStops(stops: GradientBackground["stops"]) {
  return stops
    .map((stop, index) => ({ stop, index }))
    .sort((a, b) => a.stop.offset - b.stop.offset || a.index - b.index)
    .map(({ stop }) => stop);
}
