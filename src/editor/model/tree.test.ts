import { describe, expect, it } from "vitest";
import type { GroupLayer, Layer } from "@/document/schema";
import { counter, counterIds, group, ids, rect } from "./test-layers";
import {
  allIds,
  bringToFront,
  cloneWithNewIds,
  findLayer,
  groupHeight,
  groupLayers,
  insertLayer,
  locate,
  moveLayers,
  normalizeSelection,
  removeLayer,
  sendToBack,
  stepLayers,
  ungroupLayer,
} from "./tree";

const sample = (): Layer[] => [
  rect("a"),
  group("g", [rect("b"), group("h", [rect("c")])]),
  rect("d"),
];

describe("layer tree", () => {
  it("finds layers at any depth and reports their groups", () => {
    const layers = sample();
    const c = locate(layers, "c");
    expect(c?.ancestors.map((g) => g.id)).toEqual(["g", "h"]);
    expect(c?.index).toBe(0);
    expect(findLayer(layers, "zzz")).toBeNull();
    expect(allIds(layers)).toEqual(["a", "g", "b", "h", "c", "d"]);
  });

  it("measures how deep groups are nested", () => {
    expect(groupHeight(rect("a"))).toBe(0);
    expect(groupHeight(group("g", [rect("a")]))).toBe(1);
    expect(groupHeight(sample()[1] as Layer)).toBe(2);
  });

  it("normalises a selection: unknown ids and children of a selected group drop out, order is z-order", () => {
    const layers = sample();
    expect(normalizeSelection(layers, ["d", "c", "g", "nope", "a"])).toEqual(["a", "g", "d"]);
    expect(normalizeSelection(layers, ["c", "b"])).toEqual(["b", "c"]);
  });

  it("inserts and removes inside groups", () => {
    const layers = sample();
    expect(insertLayer(layers, rect("x"), "h", 0)).toBe(true);
    expect(ids((locate(layers, "h")?.layer as GroupLayer).layers)).toEqual(["x", "c"]);
    expect(insertLayer(layers, rect("y"), "a")).toBe(false); // a is not a group
    expect(removeLayer(layers, "x")?.id).toBe("x");
    expect(removeLayer(layers, "x")).toBeNull();
  });

  describe("moving", () => {
    it("moves layers into and out of groups, keeping their order", () => {
      const layers = sample();
      expect(moveLayers(layers, ["a", "d"], "g", 1)).toBe(true);
      expect(ids((layers[0] as GroupLayer).layers)).toEqual(["b", "a", "d", "h"]);
      expect(moveLayers(layers, ["a"], null, 0)).toBe(true);
      expect(ids(layers)).toEqual(["a", "g"]);
    });

    it("never moves a group into itself or its own child", () => {
      const layers = sample();
      expect(moveLayers(layers, ["g"], "g")).toBe(false);
      expect(moveLayers(layers, ["g"], "h")).toBe(false);
      expect(allIds(layers)).toEqual(["a", "g", "b", "h", "c", "d"]);
    });

    it("refuses to nest groups deeper than the format allows", () => {
      let deep: Layer = group("g0", [rect("leaf")]);
      for (let i = 1; i < 8; i += 1) deep = group(`g${String(i)}`, [deep]);
      const layers: Layer[] = [deep, group("other", [rect("x")])];
      expect(groupHeight(deep)).toBe(8);
      expect(moveLayers(layers, ["g7"], "other")).toBe(false);
      expect(moveLayers(layers, ["x"], "g7")).toBe(true); // a plain layer may go anywhere
    });
  });

  describe("order", () => {
    it("brings to front and sends to back inside the layer's own group", () => {
      const layers: Layer[] = [rect("a"), rect("b"), rect("c"), group("g", [rect("d"), rect("e")])];
      expect(bringToFront(layers, ["a"])).toBe(true);
      expect(ids(layers)).toEqual(["b", "c", "g", "a"]);
      expect(sendToBack(layers, ["a", "g"])).toBe(true);
      expect(ids(layers)).toEqual(["g", "a", "b", "c"]);
      expect(bringToFront(layers, ["c"])).toBe(false); // already there
      const inner = [rect("d"), rect("e")];
      const g = [group("g", inner)];
      bringToFront(g, ["d"]);
      expect(ids(inner)).toEqual(["e", "d"]);
    });

    it("steps one place up or down, several layers together", () => {
      const layers = [rect("a"), rect("b"), rect("c"), rect("d")];
      expect(stepLayers(layers, ["b"], 1)).toBe(true);
      expect(ids(layers)).toEqual(["a", "c", "b", "d"]);
      expect(stepLayers(layers, ["b", "d"], 1)).toBe(false); // d is on top, b is blocked by it
      expect(stepLayers(layers, ["a", "b"], -1)).toBe(true); // a is at the bottom, b swaps with c
      expect(ids(layers)).toEqual(["a", "b", "c", "d"]);
    });
  });

  describe("grouping", () => {
    it("wraps layers in a group that takes the place of the topmost one", () => {
      const layers = [rect("a"), rect("b"), rect("c"), rect("d")];
      const made = groupLayers(layers, ["a", "c"], "G");
      expect(made?.id).toBe("G");
      expect(ids(layers)).toEqual(["b", "G", "d"]);
      expect(ids((layers[1] as GroupLayer).layers)).toEqual(["a", "c"]);
    });

    it("groups layers from different groups at the place of the topmost", () => {
      const layers: Layer[] = [group("g", [rect("a"), rect("b")]), rect("c")];
      groupLayers(layers, ["b", "c"], "G");
      expect(allIds(layers)).toEqual(["g", "a", "G", "b", "c"]);
    });

    it("does nothing for an empty selection and does not nest too deep", () => {
      const layers: Layer[] = [rect("a")];
      expect(groupLayers(layers, [], "G")).toBeNull();
      let deep: Layer = group("g0", [rect("leaf")]);
      for (let i = 1; i < 8; i += 1) deep = group(`g${String(i)}`, [deep]);
      const stack: Layer[] = [deep];
      expect(groupLayers(stack, ["g7"], "G")).toBeNull();
      expect(ids(stack)).toEqual(["g7"]);
    });

    it("ungroups in place and returns the freed ids", () => {
      const layers = [rect("a"), group("g", [rect("b"), rect("c")]), rect("d")];
      expect(ungroupLayer(layers, "g")).toEqual(["b", "c"]);
      expect(ids(layers)).toEqual(["a", "b", "c", "d"]);
      expect(ungroupLayer(layers, "a")).toEqual([]);
    });
  });

  it("clones a layer with new ids all the way down, without touching the original", () => {
    const original = group("g", [rect("a"), counter("b", 3)]);
    const next = counterIds("copy");
    const copy = cloneWithNewIds(original, next);
    expect(allIds([copy])).toEqual(["copy1", "copy2", "copy3"]);
    expect(allIds([original])).toEqual(["g", "a", "b"]);
  });
});
