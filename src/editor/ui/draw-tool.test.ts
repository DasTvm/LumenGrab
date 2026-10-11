import { describe, expect, it } from "vitest";
import type { Layer } from "@/document/schema";
import { createEditorStore } from "../model/store";
import { counter, filledRect, projectWith } from "../model/test-layers";
import { DrawController } from "./draw-tool";
import { SelectController, type PointerInfo } from "./select-tool";
import type { ToolId } from "./tools";
import { createUiStore } from "./ui-store";

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({
  p: { x, y },
  shift: false,
  alt: false,
  mod: false,
  ...extra,
});

function setup(tool: ToolId, layers: Layer[] = [], zoom = 1) {
  const editor = createEditorStore(projectWith(layers));
  const ui = createUiStore({ width: 1000, height: 800 });
  ui.getState().setView({ zoom, x: 0, y: 0 });
  ui.getState().setTool(tool);
  const select = new SelectController(editor, ui);
  return { editor, ui, tool: new DrawController(editor, ui, select) };
}
const layers = (s: ReturnType<typeof setup>) =>
  s.editor.getState().project.layers as unknown as Record<string, unknown>[];

function dragAcross(
  s: ReturnType<typeof setup>,
  from: [number, number],
  to: [number, number],
  extra: Partial<PointerInfo> = {},
) {
  s.tool.down(at(...from, extra));
  s.tool.move(at((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, extra));
  s.tool.move(at(...to, extra));
  s.tool.up(at(...to, extra));
}

describe("drawing tools", () => {
  it.each([
    ["rect", { type: "rect", x: 100, y: 50, width: 200, height: 120 }],
    ["ellipse", { type: "ellipse", x: 100, y: 50, width: 200, height: 120 }],
    ["highlighter", { type: "highlighter", rect: { x: 100, y: 50, width: 200, height: 120 } }],
    ["spotlight", { type: "spotlight", rect: { x: 100, y: 50, width: 200, height: 120 } }],
    ["redact", { type: "redaction", rect: { x: 100, y: 50, width: 200, height: 120 } }],
  ] as const)("%s: a drag makes a box, selects it, as one undo step", (tool, expected) => {
    const s = setup(tool);
    dragAcross(s, [100, 50], [300, 170]);
    expect(layers(s)).toHaveLength(1);
    expect(layers(s)[0]).toMatchObject(expected);
    expect(s.editor.getState().selection).toEqual([layers(s)[0]?.["id"]]);
    s.editor.getState().undo();
    expect(layers(s)).toHaveLength(0);
    expect(s.editor.getState().canUndo).toBe(false);
  });

  it("a box can be dragged to the upper left, squared with shift, centred with alt", () => {
    const s = setup("rect");
    dragAcross(s, [300, 200], [250, 180]);
    expect(layers(s)[0]).toMatchObject({ x: 250, y: 180, width: 50, height: 20 });
    dragAcross(s, [500, 500], [560, 520], { shift: true });
    expect(layers(s)[1]).toMatchObject({ x: 500, y: 500, width: 60, height: 60 });
    dragAcross(s, [700, 300], [730, 320], { alt: true });
    expect(layers(s)[2]).toMatchObject({ x: 670, y: 280, width: 60, height: 40 });
  });

  it("lines and arrows run from the press to the release, with shift in 45 degree steps", () => {
    const s = setup("arrow");
    dragAcross(s, [100, 100], [300, 180]);
    expect(layers(s)[0]).toMatchObject({
      type: "arrow",
      from: { x: 100, y: 100 },
      to: { x: 300, y: 180 },
      style: "straight",
    });
    s.ui.getState().setTool("line");
    dragAcross(s, [100, 400], [300, 420], { shift: true });
    const line = layers(s)[1] as { to: { x: number; y: number } };
    expect(line.to.y).toBeCloseTo(400);
    expect(line.to.x).toBeGreaterThan(299);
  });

  it("uses the options of the tool: colour, width, style", () => {
    const s = setup("arrow");
    s.ui.getState().setOption("arrow", { style: "double", color: "#2563EB", width: 10 });
    dragAcross(s, [0, 0], [100, 100]);
    expect(layers(s)[0]).toMatchObject({ style: "double", color: "#2563EB", width: 10 });
    s.ui.getState().setTool("rect");
    s.ui.getState().setOption("rect", { fill: "#C8FF2E", radius: 20 });
    dragAcross(s, [300, 300], [400, 400]); // away from the handles of the arrow just drawn
    expect(layers(s)[1]).toMatchObject({ fill: "#C8FF2E", radius: 20 });
  });

  it("a pencil stroke collects points, skipping those closer than a screen pixel", () => {
    const s = setup("pencil");
    s.tool.down(at(10, 10));
    for (let i = 1; i <= 20; i += 1) s.tool.move(at(10 + i * 2, 10 + (i % 2) * 6));
    s.tool.move(at(50.2, 10.1)); // within a pixel of the last point
    s.tool.up(at(50, 10));
    const points = layers(s)[0]?.["points"] as number[];
    expect(points.length).toBe(2 + 40);
    expect(points.slice(0, 2)).toEqual([10, 10]);
  });

  it("an accidental click with a box tool draws nothing; it picks the layer under it or clears", () => {
    const s = setup("rect", [filledRect("a", 0, 0, 100, 100)]);
    s.tool.down(at(50, 50));
    s.tool.move(at(51, 51)); // below the drag threshold
    s.tool.up(at(51, 51));
    expect(layers(s)).toHaveLength(1);
    expect(s.editor.getState().selection).toEqual(["a"]);
    s.tool.down(at(500, 500));
    s.tool.up(at(500, 500));
    expect(s.editor.getState().selection).toEqual([]);
  });

  it("a drag that ends where it began is discarded as a click", () => {
    const s = setup("rect");
    s.tool.down(at(100, 100));
    s.tool.move(at(150, 150));
    s.tool.move(at(100, 100));
    s.tool.up(at(100, 100));
    expect(layers(s)).toHaveLength(0);
    expect(s.editor.getState().canUndo).toBe(false);
  });

  it("Esc while drawing throws the shape away", () => {
    const s = setup("rect");
    s.tool.down(at(100, 100));
    s.tool.move(at(200, 200));
    expect(layers(s)).toHaveLength(1);
    s.tool.cancel();
    expect(layers(s)).toHaveLength(0);
    expect(s.editor.getState().canUndo).toBe(false);
  });

  it("the counter tool places numbered circles one above the highest, or counts on after a restart", () => {
    const s = setup("counter", [counter("c", 4, 10, 10)]);
    s.tool.down(at(300, 300));
    s.tool.up(at(300, 300));
    expect(layers(s)[1]).toMatchObject({ type: "counter", value: 5, x: 300, y: 300, size: 32 });
    s.ui.getState().setCounterNext(1);
    s.tool.down(at(400, 300));
    s.tool.up(at(400, 300));
    s.tool.down(at(500, 300));
    s.tool.up(at(500, 300));
    expect(layers(s).map((l) => l["value"])).toEqual([4, 5, 1, 2]);
    expect(s.ui.getState().counterNext).toBe(3);
    s.editor.getState().undo();
    expect(layers(s)).toHaveLength(3);
  });

  it("keeps editing the selected layer through its handles while a drawing tool is active", () => {
    const s = setup("rect", [filledRect("a", 100, 100, 100, 50)]);
    s.editor.getState().select(["a"]);
    s.tool.down(at(200, 150)); // the south-east handle
    s.tool.move(at(260, 190));
    s.tool.up(at(260, 190));
    expect(layers(s)).toHaveLength(1);
    expect(layers(s)[0]).toMatchObject({ width: 160, height: 90 });
  });
});
