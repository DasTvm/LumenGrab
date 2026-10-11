import { arrowControl, distance } from "../model/geometry";
import type { Point } from "@/document/schema";

/**
 * The shape of an arrow, as plain numbers (docs/FORMAT.md "Rendering rules"). The drawing code strokes
 * and fills it; tests check the numbers.
 *
 * - The head is a triangle: its tip is the end point, its length is `max(4 x width, 12)` (at most half
 *   of a short arrow, a third for the double style), and half its width is 0.5 x its length.
 * - The shaft stops 0.2 x head length inside the head, so the join is clean.
 * - `curved` bends the shaft as a quadratic Bézier through the control point (`curve`, or the default of
 *   `arrowControl`); a head points along the tangent at its end.
 * - `outlined` draws the head as an outline (stroked in the colour, filled white) instead of a solid
 *   triangle; `double` has a head at each end.
 */
export interface ArrowShape {
  /** The shaft: a straight segment, or a quadratic curve if `control` is set. */
  shaft: { from: Point; to: Point; control: Point | null };
  heads: { tip: Point; left: Point; right: Point }[];
  outlined: boolean;
}

const HEAD_RATIO = 4;
const MIN_HEAD = 12;
const HEAD_HALF_WIDTH = 0.5;
const SHAFT_OVERLAP = 0.2;

export interface ArrowInput {
  from: Point;
  to: Point;
  style: string;
  width: number;
  curve?: Point | undefined;
}

export function headLength(width: number, arrowLength: number, double: boolean): number {
  return Math.min(Math.max(HEAD_RATIO * width, MIN_HEAD), arrowLength * (double ? 1 / 3 : 1 / 2));
}

function unit(from: Point, to: Point): Point {
  const length = distance(from, to);
  return length === 0
    ? { x: 1, y: 0 }
    : { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

function head(tip: Point, direction: Point, length: number): ArrowShape["heads"][number] {
  const base = { x: tip.x - direction.x * length, y: tip.y - direction.y * length };
  const half = length * HEAD_HALF_WIDTH;
  return {
    tip,
    left: { x: base.x - direction.y * half, y: base.y + direction.x * half },
    right: { x: base.x + direction.y * half, y: base.y - direction.x * half },
  };
}

export function arrowShape(arrow: ArrowInput): ArrowShape {
  const double = arrow.style === "double";
  const curved = arrow.style === "curved";
  const control = curved ? arrowControl(arrow) : null;
  const total = distance(arrow.from, arrow.to);
  const length = headLength(arrow.width, total, double);
  // Direction of travel at both ends: along the line, or the tangent of the curve.
  const endDir = control ? unit(control, arrow.to) : unit(arrow.from, arrow.to);
  const startDir = control ? unit(control, arrow.from) : unit(arrow.to, arrow.from);

  const heads = [head(arrow.to, endDir, length)];
  if (double) heads.push(head(arrow.from, startDir, length));

  const inset = length * (1 - SHAFT_OVERLAP);
  const to = { x: arrow.to.x - endDir.x * inset, y: arrow.to.y - endDir.y * inset };
  const from = double
    ? { x: arrow.from.x - startDir.x * inset, y: arrow.from.y - startDir.y * inset }
    : arrow.from;
  return { shaft: { from, to, control }, heads, outlined: arrow.style === "outlined" };
}
