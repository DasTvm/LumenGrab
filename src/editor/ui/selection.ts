import { isGroup } from "@/document/layers";
import type { Layer, Point, Rect } from "@/document/schema";
import {
  boundsOf,
  canRotate,
  hasBox,
  HANDLES,
  layerBox,
  rectCenter,
  rotatePoint,
  arrowControl,
  distance,
  type Handle,
  type MeasureText,
} from "../model/geometry";
import { findLayer } from "../model/tree";

/**
 * What the user can grab on the selection (design: selection handles). Pure maths in image pixels, so
 * it is tested in Node; the canvas overlay only draws it.
 *
 * - A box layer (rectangle, ellipse, text, highlighter, spotlight, redaction) has 8 resize handles; a
 *   rectangle, ellipse and text also a rotate handle above the top edge.
 * - A line or an arrow has a handle on each end, and a curved arrow one on its bend.
 * - Everything else (a counter, a pencil stroke, a group, several layers) shows a frame and moves as one.
 */
export type Grip =
  | { kind: "resize"; handle: Handle; at: Point }
  | { kind: "rotate"; at: Point; from: Point }
  | { kind: "point"; which: "from" | "to" | "curve"; at: Point };

export interface SelectionFrame {
  /** The layer the grips edit; `null` for a frame that only moves things. */
  layerId: string | null;
  /** The frame in image pixels: the box (before rotation) or the bounds. */
  box: Rect;
  rotation: number;
  /** The four corners of the frame, rotation applied (for drawing). */
  corners: [Point, Point, Point, Point];
  grips: Grip[];
}

/** How far the rotate handle floats above the top edge, in screen pixels. */
export const ROTATE_OFFSET = 26;

function corners(box: Rect, rotation: number): SelectionFrame["corners"] {
  const c = rectCenter(box);
  const raw: SelectionFrame["corners"] = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
  return raw.map((p) =>
    rotation === 0 ? p : rotatePoint(p, c, rotation),
  ) as SelectionFrame["corners"];
}

const HANDLE_POSITION: Record<Handle, readonly [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5],
};

/** The place of a resize handle on a (rotated) box. */
export function handlePoint(box: Rect, rotation: number, handle: Handle): Point {
  const [fx, fy] = HANDLE_POSITION[handle];
  const p = { x: box.x + box.width * fx, y: box.y + box.height * fy };
  return rotation === 0 ? p : rotatePoint(p, rectCenter(box), rotation);
}

export function selectionFrame(
  layers: readonly Layer[],
  ids: readonly string[],
  zoom: number,
  measure?: MeasureText,
): SelectionFrame | null {
  const picked = ids.map((id) => findLayer(layers, id)).filter((l): l is Layer => l !== null);
  if (picked.length === 0) return null;
  const only = picked.length === 1 ? picked[0] : undefined;

  if (only && !isGroup(only) && hasBox(only) && !only.locked) {
    const box = layerBox(only, measure);
    if (box) {
      const rotation = canRotate(only) ? Number(only["rotation"] ?? 0) : 0;
      const grips: Grip[] = HANDLES.map((handle) => ({
        kind: "resize",
        handle,
        at: handlePoint(box, rotation, handle),
      }));
      if (canRotate(only)) {
        const top = handlePoint(box, rotation, "n");
        const up = rotatePoint({ x: top.x, y: top.y - ROTATE_OFFSET / zoom }, top, rotation);
        grips.push({ kind: "rotate", at: up, from: top });
      }
      return { layerId: only.id, box, rotation, corners: corners(box, rotation), grips };
    }
  }

  if (only && (only.type === "arrow" || only.type === "line") && !only.locked) {
    const from = only["from"] as Point;
    const to = only["to"] as Point;
    const grips: Grip[] = [
      { kind: "point", which: "from", at: from },
      { kind: "point", which: "to", at: to },
    ];
    if (only.type === "arrow" && only["style"] === "curved") {
      grips.push({
        kind: "point",
        which: "curve",
        at: arrowControl({ from, to, curve: only["curve"] as Point | undefined }),
      });
    }
    const box = boundsOf([only], measure) ?? { x: from.x, y: from.y, width: 0, height: 0 };
    return { layerId: only.id, box, rotation: 0, corners: corners(box, 0), grips };
  }

  const box = boundsOf(picked, measure);
  if (!box) return null;
  return { layerId: null, box, rotation: 0, corners: corners(box, 0), grips: [] };
}

/** The grip under the pointer. `radius` is in screen pixels, `zoom` converts it to image pixels. */
export function hitGrip(frame: SelectionFrame, p: Point, zoom: number, radius = 9): Grip | null {
  const reach = radius / zoom;
  // Later grips win, so the rotate handle beats a resize handle it floats near.
  for (let i = frame.grips.length - 1; i >= 0; i -= 1) {
    const grip = frame.grips[i];
    if (grip && distance(grip.at, p) <= reach) return grip;
  }
  return null;
}

/** The label of the badge under a frame while it is being resized: `228 × 40`. */
export function sizeLabel(box: Rect): string {
  return `${String(Math.round(box.width))} × ${String(Math.round(box.height))}`;
}
