import type { Layer, Point, Rect } from "@/document/schema";
import {
  constrainAngle,
  distance,
  hitTest,
  nextCounterValue,
  type MeasureText,
} from "../model/geometry";
import { randomId, type EditorStoreApi } from "../model/store";
import {
  dragBox,
  newArrow,
  newBox,
  newCounter,
  newHighlighter,
  newLine,
  newPencil,
  newRedaction,
  newSpotlight,
} from "../model/style";
import { findLayer } from "../model/tree";
import { hitGrip } from "./selection";
import { startEditText, startNewText } from "./text-edit";
import type { PointerInfo, SelectController } from "./select-tool";
import type { ToolId } from "./tools";
import type { UiStoreApi } from "./ui-store";

/** The tools that are made by dragging a box. */
const BOX_TOOLS = ["rect", "ellipse", "highlighter", "spotlight", "redact"] as const;
type BoxTool = (typeof BOX_TOOLS)[number];

const isBoxTool = (tool: ToolId): tool is BoxTool =>
  (BOX_TOOLS as readonly string[]).includes(tool);

const DRAG_THRESHOLD = 3;
/** A new box smaller than this (image pixels) is a click, not a shape. */
const MIN_SIZE = 3;
const HIT_REACH = 6;

type Drag =
  | { kind: "grip" }
  | {
      kind: "draw";
      tool: ToolId;
      start: Point;
      startScreenZoom: number;
      id: string | null;
      moved: boolean;
    };

/**
 * The drawing tools: rectangle, ellipse, line, arrow, pencil, highlighter, spotlight, redaction and
 * counter. A drag draws (one undo step), a click on a layer selects it, a click on empty space places
 * a counter. The handles of a selected layer keep working while a drawing tool is active: a press on
 * one is handed to the Select controller.
 */
export class DrawController {
  private drag: Drag | null = null;

  constructor(
    private readonly editor: EditorStoreApi,
    private readonly ui: UiStoreApi,
    private readonly select: SelectController,
    private readonly measure?: MeasureText,
  ) {}

  private get zoom(): number {
    return this.ui.getState().view?.zoom ?? 1;
  }

  get active(): boolean {
    return this.drag !== null;
  }

  down(info: PointerInfo): void {
    const tool = this.ui.getState().tool;
    const frame = this.select.frame();
    if (frame?.layerId && hitGrip(frame, info.p, this.zoom)) {
      this.drag = { kind: "grip" };
      this.select.down(info);
      return;
    }
    this.drag = {
      kind: "draw",
      tool,
      start: { x: round2(info.p.x), y: round2(info.p.y) },
      startScreenZoom: this.zoom,
      id: null,
      moved: false,
    };
  }

  move(info: PointerInfo): void {
    const drag = this.drag;
    if (!drag) return;
    if (drag.kind === "grip") {
      this.select.move(info);
      return;
    }
    if (!drag.moved) {
      if (distance(info.p, drag.start) * this.zoom < DRAG_THRESHOLD) return;
      drag.moved = true;
      this.begin(drag);
    }
    this.update(drag, info);
  }

  up(info: PointerInfo): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    if (drag.kind === "grip") {
      this.select.up(info);
      return;
    }
    const state = this.editor.getState();
    if (drag.id !== null) {
      // A box that stayed a speck is a click that wobbled.
      if (this.tooSmall(drag)) {
        state.cancelGesture();
        this.click(drag.tool, drag.start, info);
        return;
      }
      state.endGesture();
      return;
    }
    this.click(drag.tool, drag.start, info);
  }

  /** Esc while drawing. */
  cancel(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag?.kind === "grip") this.select.cancel();
    else if (drag?.kind === "draw" && drag.id !== null) this.editor.getState().cancelGesture();
  }

  cursor(p: Point): string {
    const frame = this.select.frame();
    if (frame?.layerId && hitGrip(frame, p, this.zoom)) return this.select.cursor(p);
    return "crosshair";
  }

  // ---- a click ------------------------------------------------------------------------------------

  private click(tool: ToolId, at: Point, info: PointerInfo): void {
    const { editor, ui } = this;
    if (tool === "counter") {
      const { project } = editor.getState();
      const value = ui.getState().counterNext ?? nextCounterValue(project.layers);
      editor.getState().addLayer(newCounter(randomId(), at, value, ui.getState().options.counter));
      if (ui.getState().counterNext !== null) ui.getState().setCounterNext(value + 1);
      return;
    }
    const hit = hitTest(editor.getState().project.layers, at, HIT_REACH / this.zoom, {
      measure: this.measure,
    });
    if (tool === "text") {
      // A click on a text edits it; anywhere else starts a new one.
      if (!(hit && startEditText(editor, ui, hit))) startNewText(editor, ui, at);
      return;
    }
    // Any other tool: a click picks the layer under it, or clears the selection.
    if (hit) {
      if (info.shift || info.mod) {
        const current = editor.getState().selection;
        editor
          .getState()
          .select(current.includes(hit) ? current.filter((id) => id !== hit) : [...current, hit]);
      } else {
        editor.getState().select([hit]);
      }
    } else if (!info.shift && !info.mod) {
      editor.getState().select([]);
    }
  }

  // ---- a drag -------------------------------------------------------------------------------------

  private begin(drag: Extract<Drag, { kind: "draw" }>): void {
    const { editor, ui } = this;
    const o = ui.getState().options;
    const id = randomId();
    const at = drag.start;
    let layer: Layer | null = null;
    switch (drag.tool) {
      case "rect":
        layer = newBox("rect", id, { ...at, width: 0, height: 0 }, o.rect);
        break;
      case "ellipse":
        layer = newBox("ellipse", id, { ...at, width: 0, height: 0 }, o.ellipse);
        break;
      case "line":
        layer = newLine(id, { ...at }, { ...at }, o.line);
        break;
      case "arrow":
        layer = newArrow(id, { ...at }, { ...at }, o.arrow);
        break;
      case "pencil":
        layer = newPencil(id, at, o.pencil);
        break;
      case "highlighter":
        layer = newHighlighter(id, { ...at, width: 0, height: 0 }, o.highlighter);
        break;
      case "spotlight":
        layer = newSpotlight(id, { ...at, width: 0, height: 0 }, o.spotlight);
        break;
      case "redact":
        layer = newRedaction(id, { ...at, width: 0, height: 0 }, o.redact, randomSeed());
        break;
      default:
        break;
    }
    if (!layer) return;
    editor.getState().beginGesture();
    editor.getState().addLayer(layer);
    drag.id = id;
  }

  private update(drag: Extract<Drag, { kind: "draw" }>, info: PointerInfo): void {
    const id = drag.id;
    if (id === null) return;
    const { editor } = this;
    const at = info.p;
    editor.getState().change((p) => {
      const layer = findLayer(p.layers, id);
      if (!layer) return;
      if (isBoxTool(drag.tool)) {
        const box = roundBox(dragBox(drag.start, at, { square: info.shift, center: info.alt }));
        if (
          layer.type === "highlighter" ||
          layer.type === "spotlight" ||
          layer.type === "redaction"
        ) {
          layer["rect"] = box;
        } else {
          layer["x"] = box.x;
          layer["y"] = box.y;
          layer["width"] = box.width;
          layer["height"] = box.height;
        }
      } else if (drag.tool === "line" || drag.tool === "arrow") {
        const end = info.shift ? constrainAngle(drag.start, at) : at;
        layer["to"] = { x: round2(end.x), y: round2(end.y) };
      } else if (drag.tool === "pencil") {
        const points = layer["points"] as number[];
        const lx = points[points.length - 2] ?? 0;
        const ly = points[points.length - 1] ?? 0;
        // Skip points closer than a screen pixel: they only make the file bigger.
        if (distance({ x: lx, y: ly }, at) * this.zoom >= 1)
          points.push(round2(at.x), round2(at.y));
      }
    });
  }

  private tooSmall(drag: Extract<Drag, { kind: "draw" }>): boolean {
    const id = drag.id;
    if (id === null) return false;
    const layer = findLayer(this.editor.getState().project.layers, id);
    if (!layer) return true;
    if (isBoxTool(drag.tool)) {
      const box = (layer["rect"] as Rect | undefined) ?? {
        width: Number(layer["width"]),
        height: Number(layer["height"]),
      };
      return box.width < MIN_SIZE && box.height < MIN_SIZE;
    }
    if (drag.tool === "line" || drag.tool === "arrow") {
      return distance(layer["from"] as Point, layer["to"] as Point) < MIN_SIZE;
    }
    return false; // a pencil stroke is always a stroke
  }
}

const round2 = (v: number): number => Math.round(v * 100) / 100;
const roundBox = (r: Rect): Rect => ({
  x: round2(r.x),
  y: round2(r.y),
  width: round2(r.width),
  height: round2(r.height),
});

/** The pixelate noise seed of a new redaction (a 32-bit number, stored in the file so the export is repeatable). */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}
