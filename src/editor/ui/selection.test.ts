import { describe, expect, it } from "vitest";
import type { Layer } from "@/document/schema";
import { arrow, counter, filledRect, group, redaction } from "../model/test-layers";
import { handlePoint, hitGrip, selectionFrame, sizeLabel } from "./selection";

describe("selection frame", () => {
  it("gives a rectangle eight resize handles and a rotate handle above it", () => {
    const frame = selectionFrame([filledRect("a", 100, 100, 200, 100)], ["a"], 1);
    expect(frame?.layerId).toBe("a");
    expect(frame?.grips).toHaveLength(9);
    const rotate = frame?.grips.find((g) => g.kind === "rotate");
    expect(rotate?.at).toEqual({ x: 200, y: 100 - 26 });
  });

  it("keeps the rotate handle the same distance on screen at any zoom", () => {
    const frame = selectionFrame([filledRect("a", 100, 100, 200, 100)], ["a"], 2);
    expect(frame?.grips.find((g) => g.kind === "rotate")?.at).toEqual({ x: 200, y: 100 - 13 });
  });

  it("puts the handles of a rotated box where its corners went", () => {
    const turned = { ...filledRect("a", 0, 0, 100, 50), rotation: 90 } as Layer;
    const frame = selectionFrame([turned], ["a"], 1);
    const nw = frame?.grips.find((g) => g.kind === "resize" && g.handle === "nw");
    expect(nw?.at.x).toBeCloseTo(75);
    expect(nw?.at.y).toBeCloseTo(-25);
    expect(handlePoint({ x: 0, y: 0, width: 100, height: 50 }, 0, "se")).toEqual({ x: 100, y: 50 });
  });

  it("gives redactions resize handles but no rotate handle", () => {
    const frame = selectionFrame([redaction("r", 0, 0, 40, 20)], ["r"], 1);
    expect(frame?.grips.some((g) => g.kind === "rotate")).toBe(false);
    expect(frame?.grips).toHaveLength(8);
  });

  it("gives an arrow a handle on each end and a curved one a handle on the bend", () => {
    const straight = selectionFrame([arrow("a", { x: 0, y: 0 }, { x: 100, y: 0 })], ["a"], 1);
    expect(straight?.grips.map((g) => g.kind === "point" && g.which)).toEqual(["from", "to"]);
    const curved = {
      ...arrow("a", { x: 0, y: 0 }, { x: 100, y: 0 }),
      style: "curved",
      curve: { x: 50, y: 40 },
    } as Layer;
    const frame = selectionFrame([curved], ["a"], 1);
    expect(frame?.grips.map((g) => g.kind === "point" && g.which)).toEqual(["from", "to", "curve"]);
    expect(frame?.grips[2]?.at).toEqual({ x: 50, y: 40 });
  });

  it("only moves a counter, a group and several layers (a frame, no grips)", () => {
    expect(selectionFrame([counter("c", 1, 10, 10)], ["c"], 1)?.grips).toEqual([]);
    expect(selectionFrame([group("g", [filledRect("a")])], ["g"], 1)?.layerId).toBeNull();
    const many = selectionFrame(
      [filledRect("a", 0, 0, 10, 10), filledRect("b", 50, 50, 10, 10)],
      ["a", "b"],
      1,
    );
    expect(many?.layerId).toBeNull();
    expect(many?.box.width).toBeGreaterThan(60);
  });

  it("offers no grips on a locked layer, and no frame for nothing", () => {
    expect(selectionFrame([{ ...filledRect("a"), locked: true }], ["a"], 1)?.grips).toEqual([]);
    expect(selectionFrame([filledRect("a")], [], 1)).toBeNull();
    expect(selectionFrame([filledRect("a")], ["zzz"], 1)).toBeNull();
  });

  it("finds the grip under the pointer, the rotate handle first, within a reach that shrinks with zoom", () => {
    const frame = selectionFrame([filledRect("a", 100, 100, 200, 100)], ["a"], 1);
    if (!frame) throw new Error("frame");
    expect(hitGrip(frame, { x: 102, y: 98 }, 1)).toMatchObject({ kind: "resize", handle: "nw" });
    expect(hitGrip(frame, { x: 200, y: 75 }, 1)).toMatchObject({ kind: "rotate" });
    expect(hitGrip(frame, { x: 150, y: 150 }, 1)).toBeNull();
    expect(hitGrip(frame, { x: 108, y: 100 }, 4)).toBeNull(); // 8 px away is 2 px of reach at 400 %
    expect(hitGrip(frame, { x: 108, y: 100 }, 1)).toMatchObject({ handle: "nw" });
  });

  it("labels a size", () => {
    expect(sizeLabel({ x: 0, y: 0, width: 228.4, height: 39.6 })).toBe("228 × 40");
  });
});
