import type { Point, Rect } from "@/document/schema";
import {
  angleAround,
  applyBox,
  arrowControl,
  constrainAngle,
  distance,
  hitTest,
  layerBounds,
  normalizeRect,
  rectCenter,
  resizeBox,
  snapAngle,
  type MeasureText,
} from "../model/geometry";
import type { EditorStoreApi } from "../model/store";
import { findLayer } from "../model/tree";
import { hitGrip, selectionFrame, type Grip, type SelectionFrame } from "./selection";
import type { UiStoreApi } from "./ui-store";

export interface PointerInfo {
  /** The pointer in image pixels. */
  p: Point;
  shift: boolean;
  alt: boolean;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod: boolean;
}

/** How far the pointer reaches to hit a thin layer, in screen pixels. */
const HIT_REACH = 6;
/** The pointer must travel this far (screen pixels) before a click becomes a drag. */
const DRAG_THRESHOLD = 3;
const MIN_SIZE = 4;

type Drag =
  | { kind: "move"; start: Point; applied: Point; started: boolean; hit: string }
  | { kind: "resize"; id: string; grip: Extract<Grip, { kind: "resize" }>; frame: SelectionFrame }
  | { kind: "rotate"; id: string; center: Point; angle0: number; rotation0: number }
  | { kind: "point"; id: string; which: "from" | "to" | "curve" }
  | { kind: "marquee"; start: Point; additive: string[] };

/**
 * The Select tool: click, shift/cmd-click, move, resize, rotate, drag the ends of an arrow, marquee.
 * It talks to the stores only; the canvas feeds it pointer events in image pixels. One drag is one
 * undo step (`beginGesture`/`endGesture`).
 */
export class SelectController {
  private drag: Drag | null = null;
  /** The marquee rectangle while one is dragged, for the overlay. */
  marquee: Rect | null = null;
  /** The size shown in the badge while a box is resized. */
  resizing: Rect | null = null;

  constructor(
    private readonly editor: EditorStoreApi,
    private readonly ui: UiStoreApi,
    private readonly measure?: MeasureText,
  ) {}

  private get zoom(): number {
    return this.ui.getState().view?.zoom ?? 1;
  }

  get active(): boolean {
    return this.drag !== null;
  }

  frame(): SelectionFrame | null {
    const { project, selection } = this.editor.getState();
    return selectionFrame(project.layers, selection, this.zoom, this.measure);
  }

  down(info: PointerInfo): void {
    const state = this.editor.getState();
    const frame = this.frame();
    const grip = frame ? hitGrip(frame, info.p, this.zoom) : null;
    if (frame?.layerId && grip) {
      this.startGrip(frame, grip, info);
      return;
    }
    const hit = hitTest(state.project.layers, info.p, HIT_REACH / this.zoom, {
      measure: this.measure,
    });
    if (hit) {
      if (info.shift || info.mod) {
        const next = state.selection.includes(hit)
          ? state.selection.filter((id) => id !== hit)
          : [...state.selection, hit];
        this.editor.getState().select(next);
        return;
      }
      if (!state.selection.includes(hit)) this.editor.getState().select([hit]);
      this.drag = { kind: "move", start: info.p, applied: { x: 0, y: 0 }, started: false, hit };
      return;
    }
    const additive = info.shift || info.mod ? state.selection : [];
    if (additive.length === 0) this.editor.getState().select([]);
    this.drag = { kind: "marquee", start: info.p, additive };
  }

  private startGrip(frame: SelectionFrame, grip: Grip, info: PointerInfo): void {
    const id = frame.layerId;
    if (!id) return;
    this.editor.getState().beginGesture();
    if (grip.kind === "resize") {
      this.drag = { kind: "resize", id, grip, frame };
      this.resizing = frame.box;
    } else if (grip.kind === "rotate") {
      const center = rectCenter(frame.box);
      this.drag = {
        kind: "rotate",
        id,
        center,
        angle0: angleAround(center, info.p),
        rotation0: frame.rotation,
      };
    } else {
      this.drag = { kind: "point", id, which: grip.which };
    }
  }

  move(info: PointerInfo): void {
    const drag = this.drag;
    if (!drag) return;
    const { editor } = this;
    switch (drag.kind) {
      case "move": {
        if (!drag.started) {
          if (distance(info.p, drag.start) * this.zoom < DRAG_THRESHOLD) return;
          editor.getState().beginGesture();
          drag.started = true;
        }
        let dx = round2(info.p.x - drag.start.x);
        let dy = round2(info.p.y - drag.start.y);
        if (info.shift) {
          if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const step = { x: dx - drag.applied.x, y: dy - drag.applied.y };
        if (step.x !== 0 || step.y !== 0) {
          editor.getState().nudge(step.x, step.y);
          drag.applied = { x: dx, y: dy };
        }
        return;
      }
      case "resize": {
        const box = resizeBox(drag.frame.box, drag.grip.handle, info.p, {
          keepAspect: info.shift,
          fromCenter: info.alt,
          min: MIN_SIZE,
          rotation: drag.frame.rotation,
        });
        const rounded = roundBox(box);
        this.resizing = rounded;
        editor.getState().change((p) => {
          const layer = findLayer(p.layers, drag.id);
          if (layer) applyBox(layer, rounded);
        });
        return;
      }
      case "rotate": {
        let rotation = drag.rotation0 + (angleAround(drag.center, info.p) - drag.angle0);
        if (info.shift) rotation = snapAngle(rotation, 15);
        rotation = ((((rotation + 180) % 360) + 360) % 360) - 180;
        editor.getState().change((p) => {
          const layer = findLayer(p.layers, drag.id);
          if (layer) layer["rotation"] = Math.round(rotation * 100) / 100;
        });
        return;
      }
      case "point": {
        editor.getState().change((p) => {
          const layer = findLayer(p.layers, drag.id);
          if (!layer) return;
          const from = layer["from"] as Point;
          const to = layer["to"] as Point;
          if (drag.which === "curve") {
            layer["curve"] = { x: info.p.x, y: info.p.y };
            return;
          }
          const other = drag.which === "from" ? to : from;
          const at = info.shift ? constrainAngle(other, info.p) : info.p;
          const target = drag.which === "from" ? from : to;
          // A curve without a stored control point follows its default; once the user bends it, it stays.
          if (layer["style"] === "curved" && !layer["curve"]) {
            layer["curve"] = arrowControl({ from, to });
          }
          target.x = at.x;
          target.y = at.y;
        });
        return;
      }
      case "marquee": {
        this.marquee = normalizeRect(drag.start, info.p);
        return;
      }
    }
  }

  up(info: PointerInfo): void {
    const drag = this.drag;
    this.drag = null;
    this.resizing = null;
    if (!drag) return;
    const state = this.editor.getState();
    switch (drag.kind) {
      case "move":
        if (drag.started) state.endGesture();
        else if (!info.shift && !info.mod && state.selection.length > 1) state.select([drag.hit]);
        return;
      case "marquee": {
        const area = this.marquee;
        this.marquee = null;
        if (!area || (area.width < 2 && area.height < 2)) return;
        const inside = state.project.layers
          .filter((l) => l.visible && !l.locked && intersects(layerBounds(l, this.measure), area))
          .map((l) => l.id);
        state.select([...new Set([...drag.additive, ...inside])]);
        return;
      }
      default:
        state.endGesture();
    }
  }

  /** Esc during a drag: everything goes back. */
  cancel(): void {
    const drag = this.drag;
    this.drag = null;
    this.resizing = null;
    this.marquee = null;
    if (drag && drag.kind !== "marquee" && !(drag.kind === "move" && !drag.started)) {
      this.editor.getState().cancelGesture();
    }
  }

  /** The CSS cursor for the pointer position while nothing is dragged. */
  cursor(p: Point): string {
    const frame = this.frame();
    const grip = frame ? hitGrip(frame, p, this.zoom) : null;
    if (grip?.kind === "resize") {
      return {
        n: "ns-resize",
        s: "ns-resize",
        e: "ew-resize",
        w: "ew-resize",
        nw: "nwse-resize",
        se: "nwse-resize",
        ne: "nesw-resize",
        sw: "nesw-resize",
      }[grip.handle];
    }
    if (grip?.kind === "rotate") return "grab";
    if (grip) return "crosshair";
    const { project } = this.editor.getState();
    return hitTest(project.layers, p, HIT_REACH / this.zoom, { measure: this.measure })
      ? "move"
      : "default";
  }
}

/** Positions and sizes are kept to a hundredth of a pixel: pointer maths at odd zooms leaves 499.99999 behind. */
const round2 = (v: number): number => Math.round(v * 100) / 100;
const roundBox = (r: Rect): Rect => ({
  x: round2(r.x),
  y: round2(r.y),
  width: round2(r.width),
  height: round2(r.height),
});

function intersects(bounds: Rect | null, area: Rect): boolean {
  return (
    bounds !== null &&
    bounds.x < area.x + area.width &&
    bounds.x + bounds.width > area.x &&
    bounds.y < area.y + area.height &&
    bounds.y + bounds.height > area.y
  );
}
