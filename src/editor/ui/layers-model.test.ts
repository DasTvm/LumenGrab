import { describe, expect, it } from "vitest";
import type { Layer } from "@/document/schema";
import { createEditorStore } from "../model/store";
import { filledRect, group, ids, projectWith, rect } from "../model/test-layers";
import { buildRows, dropPosition, dropTarget } from "./layers-model";

const sample = (): Layer[] => [rect("a"), group("g", [rect("b"), rect("c")]), rect("d")];

describe("layer rows", () => {
  it("lists the front layer first, children under their group", () => {
    const rows = buildRows(sample(), []);
    expect(rows.map((r) => [r.layer.id, r.depth])).toEqual([
      ["d", 0],
      ["g", 0],
      ["c", 1],
      ["b", 1],
      ["a", 0],
    ]);
    expect(rows.find((r) => r.layer.id === "c")?.parentId).toBe("g");
    expect(rows.find((r) => r.layer.id === "g")?.count).toBe(2);
  });

  it("hides the children of a collapsed group, keeping its count", () => {
    const rows = buildRows(sample(), ["g"]);
    expect(rows.map((r) => r.layer.id)).toEqual(["d", "g", "a"]);
    expect(rows[1]).toMatchObject({ collapsed: true, count: 2 });
  });

  it("dims what is hidden and marks what is locked, also through groups", () => {
    const layers: Layer[] = [
      group("g", [rect("b")], { visible: false, locked: true }),
      { ...rect("x"), visible: false },
    ];
    const rows = buildRows(layers, []);
    expect(rows.map((r) => [r.layer.id, r.dimmed, r.locked])).toEqual([
      ["x", true, false],
      ["g", true, true],
      ["b", true, true],
    ]);
  });
});

describe("drop targets", () => {
  it("drops above and below a row inside its own group", () => {
    const layers = sample();
    expect(dropTarget(layers, ["a"], "d", "above")).toEqual({ parentId: null, index: 2 }); // d is last after a leaves: in front of it
    expect(dropTarget(layers, ["d"], "a", "below")).toEqual({ parentId: null, index: 0 });
    expect(dropTarget(layers, ["a"], "c", "above")).toEqual({ parentId: "g", index: 2 });
    expect(dropTarget(layers, ["a"], "b", "below")).toEqual({ parentId: "g", index: 0 });
  });

  it("drops inside a group at its front", () => {
    expect(dropTarget(sample(), ["a"], "g", "inside")).toEqual({ parentId: "g", index: 2 });
    expect(dropTarget(sample(), ["a"], "d", "inside")).toBeNull(); // not a group
  });

  it("refuses to drop on itself, a group into itself or into its own child", () => {
    const layers = sample();
    expect(dropTarget(layers, ["a"], "a", "above")).toBeNull();
    expect(dropTarget(layers, ["g"], "g", "inside")).toBeNull();
    expect(dropTarget(layers, ["g"], "c", "above")).toBeNull();
  });

  it("does what it says when the store applies it", () => {
    const editor = createEditorStore(
      projectWith([filledRect("a"), group("g", [rect("b")]), rect("d")]),
    );
    const target = dropTarget(editor.getState().project.layers, ["a"], "b", "above");
    if (!target) throw new Error("target");
    editor.getState().moveTo(["a"], target.parentId, target.index);
    const g = editor.getState().project.layers[0] as unknown as { layers: Layer[] };
    expect(ids(g.layers)).toEqual(["b", "a"]); // in front of b
  });

  it("reads the pointer position as a third of the row", () => {
    expect(dropPosition(2, 36, true)).toBe("above");
    expect(dropPosition(18, 36, true)).toBe("inside");
    expect(dropPosition(18, 36, false)).toBe("below");
    expect(dropPosition(30, 36, true)).toBe("below");
  });
});
