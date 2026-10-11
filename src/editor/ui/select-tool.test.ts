import { describe, expect, it } from "vitest";
import type { Layer } from "@/document/schema";
import { createEditorStore } from "../model/store";
import { arrow, counterIds, filledRect, group, projectWith } from "../model/test-layers";
import { SelectController, type PointerInfo } from "./select-tool";
import { createUiStore } from "./ui-store";

const at = (x: number, y: number, extra: Partial<PointerInfo> = {}): PointerInfo => ({
  p: { x, y },
  shift: false,
  alt: false,
  mod: false,
  ...extra,
});

function setup(layers: Layer[], zoom = 1) {
  const editor = createEditorStore(projectWith(layers), { makeId: counterIds() });
  const ui = createUiStore();
  ui.getState().setView({ zoom, x: 0, y: 0 });
  return { editor, ui, tool: new SelectController(editor, ui) };
}
const layer = (editor: ReturnType<typeof setup>["editor"], i: number) =>
  editor.getState().project.layers[i] as unknown as Record<string, unknown>;

describe("select tool", () => {
  it("selects what is clicked and clears on a click into empty space", () => {
    const { editor, tool } = setup([
      filledRect("a", 0, 0, 50, 50),
      filledRect("b", 100, 0, 50, 50),
    ]);
    tool.down(at(10, 10));
    tool.up(at(10, 10));
    expect(editor.getState().selection).toEqual(["a"]);
    tool.down(at(120, 10));
    tool.up(at(120, 10));
    expect(editor.getState().selection).toEqual(["b"]);
    tool.down(at(300, 300));
    tool.up(at(300, 300));
    expect(editor.getState().selection).toEqual([]);
  });

  it("adds and removes with shift or cmd, and a click on one of several selects just that one", () => {
    const { editor, tool } = setup([
      filledRect("a", 0, 0, 50, 50),
      filledRect("b", 100, 0, 50, 50),
    ]);
    tool.down(at(10, 10));
    tool.up(at(10, 10));
    tool.down(at(120, 10, { shift: true }));
    tool.up(at(120, 10, { shift: true }));
    expect(editor.getState().selection).toEqual(["a", "b"]);
    tool.down(at(10, 10, { mod: true }));
    tool.up(at(10, 10, { mod: true }));
    expect(editor.getState().selection).toEqual(["b"]);
    tool.down(at(10, 10, { shift: true }));
    tool.up(at(10, 10, { shift: true }));
    tool.down(at(10, 10));
    tool.up(at(10, 10));
    expect(editor.getState().selection).toEqual(["a"]);
  });

  it("moves the selection with the pointer as one undo step, and a tiny wiggle is only a click", () => {
    const { editor, tool } = setup([filledRect("a", 0, 0, 50, 50)]);
    tool.down(at(10, 10));
    tool.move(at(11, 10));
    tool.up(at(11, 10));
    expect(layer(editor, 0)["x"]).toBe(0);
    expect(editor.getState().canUndo).toBe(false);

    tool.down(at(10, 10));
    for (let i = 1; i <= 10; i += 1) tool.move(at(10 + i * 3, 10 + i));
    tool.up(at(40, 20));
    expect(layer(editor, 0)).toMatchObject({ x: 30, y: 10 });
    editor.getState().undo();
    expect(layer(editor, 0)).toMatchObject({ x: 0, y: 0 });
    expect(editor.getState().canUndo).toBe(false);
  });

  it("moves along one axis with shift, and puts everything back on cancel", () => {
    const { editor, tool } = setup([filledRect("a", 0, 0, 50, 50)]);
    tool.down(at(10, 10));
    tool.move(at(60, 25, { shift: true }));
    expect(layer(editor, 0)).toMatchObject({ x: 50, y: 0 });
    tool.cancel();
    expect(layer(editor, 0)).toMatchObject({ x: 0, y: 0 });
    expect(editor.getState().canUndo).toBe(false);
  });

  it("does not move a locked layer", () => {
    const { editor, tool } = setup([{ ...filledRect("a", 0, 0, 50, 50), locked: true }]);
    tool.down(at(10, 10)); // locked layers cannot be hit
    tool.move(at(50, 50));
    tool.up(at(50, 50));
    expect(layer(editor, 0)["x"]).toBe(0);
    expect(editor.getState().selection).toEqual([]);
  });

  it("resizes from a handle, holding the opposite corner, in one step", () => {
    const { editor, tool } = setup([filledRect("a", 100, 100, 100, 50)]);
    editor.getState().select(["a"]);
    tool.down(at(200, 150)); // the south-east handle
    tool.move(at(260, 190));
    expect(tool.resizing).toMatchObject({ width: 160, height: 90 });
    tool.up(at(260, 190));
    expect(layer(editor, 0)).toMatchObject({ x: 100, y: 100, width: 160, height: 90 });
    editor.getState().undo();
    expect(layer(editor, 0)).toMatchObject({ width: 100, height: 50 });
  });

  it("rotates with the handle, relative to where it was grabbed, snapping with shift", () => {
    const { editor, tool } = setup([filledRect("a", 100, 100, 100, 50)]);
    editor.getState().select(["a"]);
    tool.down(at(150, 74)); // the rotate handle, 26 px above the top edge
    tool.move(at(250, 125)); // straight to the right of the centre (150, 125): a quarter turn
    expect(layer(editor, 0)["rotation"]).toBeCloseTo(90);
    tool.move(at(240, 150, { shift: true }));
    expect(Number(layer(editor, 0)["rotation"]) % 15).toBe(0);
    tool.up(at(240, 150));
    editor.getState().undo();
    expect(layer(editor, 0)["rotation"]).toBe(0);
  });

  it("drags the end points of an arrow and bends it", () => {
    const curved = {
      ...arrow("a", { x: 0, y: 100 }, { x: 200, y: 100 }),
      style: "curved",
    } as Layer;
    const { editor, tool } = setup([curved]);
    editor.getState().select(["a"]);
    tool.down(at(200, 100));
    tool.move(at(220, 60));
    tool.up(at(220, 60));
    expect(layer(editor, 0)["to"]).toEqual({ x: 220, y: 60 });
    // The curve kept its default bend instead of jumping when an end moved.
    expect(layer(editor, 0)["curve"]).toBeDefined();
    const bend = layer(editor, 0)["curve"] as { x: number; y: number };
    tool.down(at(bend.x, bend.y));
    tool.move(at(110, 10));
    tool.up(at(110, 10));
    expect(layer(editor, 0)["curve"]).toEqual({ x: 110, y: 10 });
    expect(editor.getState().project.layers).toHaveLength(1);
  });

  it("selects with a marquee, adding with shift", () => {
    const { editor, tool } = setup([
      filledRect("a", 0, 0, 20, 20),
      filledRect("b", 100, 0, 20, 20),
      filledRect("c", 300, 300, 20, 20),
    ]);
    tool.down(at(-10, -10));
    tool.move(at(140, 40));
    expect(tool.marquee).toMatchObject({ x: -10, width: 150 });
    tool.up(at(140, 40));
    expect(editor.getState().selection).toEqual(["a", "b"]);
    tool.down(at(290, 290, { shift: true }));
    tool.move(at(340, 340, { shift: true }));
    tool.up(at(340, 340, { shift: true }));
    expect(editor.getState().selection).toEqual(["a", "b", "c"]);
  });

  it("treats a group as one thing", () => {
    const { editor, tool } = setup([
      group("g", [filledRect("a", 0, 0, 20, 20), filledRect("b", 50, 0, 20, 20)]),
    ]);
    tool.down(at(10, 10));
    expect(editor.getState().selection).toEqual(["g"]);
    tool.move(at(30, 10));
    tool.up(at(30, 10));
    const g = editor.getState().project.layers[0] as unknown as { layers: { x: number }[] };
    expect(g.layers.map((l) => l.x)).toEqual([20, 70]);
  });

  it("reaches thin layers further at low zoom and a cursor says what is under the pointer", () => {
    const { tool, editor } = setup([arrow("a", { x: 0, y: 0 }, { x: 100, y: 0 })], 0.25);
    expect(tool.cursor({ x: 50, y: 20 })).toBe("move"); // 6 screen px at 25 % = 24 image px
    expect(tool.cursor({ x: 50, y: 60 })).toBe("default");
    editor.getState().select(["a"]);
    expect(tool.cursor({ x: 100, y: 0 })).toBe("crosshair");
  });
});
