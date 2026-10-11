import { describe, expect, it } from "vitest";
import type { Layer, Rect } from "@/document/schema";
import {
  angleAround,
  arrowControl,
  boundsOf,
  clampRect,
  constrainAngle,
  constrainSquare,
  curvePoints,
  distanceToSegment,
  fitAspect,
  hitLayer,
  hitTest,
  layerBounds,
  nextCounterValue,
  normalizeRect,
  resizeBox,
  resizeCrop,
  rotatePoint,
  snapAngle,
  snapValue,
  translateLayer,
  applyBox,
} from "./geometry";
import { arrow, counter, filledRect, group, redaction, rect } from "./test-layers";

const close = (a: number, b: number, digits = 6) => {
  expect(a).toBeCloseTo(b, digits);
};

describe("basics", () => {
  it("normalises a rectangle dragged in any direction", () => {
    expect(normalizeRect({ x: 10, y: 20 }, { x: 4, y: 30 })).toEqual({
      x: 4,
      y: 20,
      width: 6,
      height: 10,
    });
  });
  it("rotates clockwise on screen (y down)", () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    close(p.x, 0);
    close(p.y, 10);
  });
  it("measures the distance to a segment, also past its ends", () => {
    expect(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distanceToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});

describe("bounds", () => {
  it("includes the stroke and a rotation", () => {
    expect(layerBounds(rect("a", 10, 10, 20, 10))).toEqual({ x: 9, y: 9, width: 22, height: 12 });
    const turned = { ...rect("a", 0, 0, 20, 10), strokeWidth: 0, rotation: 90 } as Layer;
    const b = layerBounds(turned) as Rect;
    close(b.width, 10);
    close(b.height, 20);
    close(b.x + b.width / 2, 10); // still around the same centre
  });
  it("covers a counter's circle, a pencil stroke and a curved arrow", () => {
    expect(layerBounds(counter("c", 1, 50, 50))).toEqual({ x: 40, y: 40, width: 20, height: 20 });
    const pencil = {
      id: "p",
      visible: true,
      locked: false,
      type: "pencil",
      points: [0, 0, 10, 20],
      color: "#000000",
      width: 4,
      smoothing: 0,
    } as Layer;
    expect(layerBounds(pencil)).toEqual({ x: -2, y: -2, width: 14, height: 24 });
    const curved = {
      ...arrow("a", { x: 0, y: 0 }, { x: 100, y: 0 }),
      style: "curved",
      curve: { x: 50, y: 80 },
    } as Layer;
    const b = layerBounds(curved) as Rect;
    expect(b.height).toBeGreaterThan(30); // the bend is part of it
  });
  it("is the union of the children for a group, and null for an empty one", () => {
    expect(layerBounds(group("g", []))).toBeNull();
    const b = boundsOf([
      group("g", [filledRect("a", 0, 0, 10, 10), filledRect("b", 20, 20, 10, 10)]),
    ]) as Rect;
    expect([b.x, b.y, b.width, b.height]).toEqual([-1, -1, 32, 32]);
  });
});

describe("hit testing", () => {
  it("hits the edge of an unfilled rectangle but not its inside, the inside of a filled one", () => {
    const outline = rect("a", 0, 0, 100, 100);
    expect(hitLayer(outline, { x: 0, y: 50 }, 3)).toBe(true);
    expect(hitLayer(outline, { x: 50, y: 50 }, 3)).toBe(false);
    expect(hitLayer(outline, { x: -10, y: 50 }, 3)).toBe(false);
    expect(hitLayer(filledRect("b", 0, 0, 100, 100), { x: 50, y: 50 }, 3)).toBe(true);
  });
  it("respects rotation", () => {
    const turned = { ...filledRect("a", 0, 0, 100, 10), rotation: 90 } as Layer; // centre (50, 5): now 10 wide, 100 tall
    expect(hitLayer(turned, { x: 50, y: -40 }, 0)).toBe(true);
    expect(hitLayer(turned, { x: 5, y: 5 }, 0)).toBe(false);
  });
  it("hits an ellipse by its outline or fill", () => {
    const e = {
      id: "e",
      visible: true,
      locked: false,
      type: "ellipse",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      stroke: "#000000",
      fill: null,
      strokeWidth: 2,
    } as Layer;
    expect(hitLayer(e, { x: 50, y: 0 }, 2)).toBe(true);
    expect(hitLayer(e, { x: 50, y: 25 }, 2)).toBe(false);
    expect(hitLayer({ ...e, fill: "#FF0000" }, { x: 50, y: 25 }, 2)).toBe(true);
    expect(hitLayer({ ...e, fill: "#FF0000" }, { x: 2, y: 2 }, 0)).toBe(false); // corner of the box
  });
  it("hits lines, arrows (also curved), counters and redactions", () => {
    expect(hitLayer(arrow("a", { x: 0, y: 0 }, { x: 100, y: 0 }), { x: 50, y: 4 }, 4)).toBe(true);
    expect(hitLayer(arrow("a", { x: 0, y: 0 }, { x: 100, y: 0 }), { x: 50, y: 20 }, 4)).toBe(false);
    const curved = {
      ...arrow("a", { x: 0, y: 0 }, { x: 100, y: 0 }),
      style: "curved",
      curve: { x: 50, y: 100 },
    } as Layer;
    expect(hitLayer(curved, { x: 50, y: 50 }, 3)).toBe(true); // the middle of the bend: halfway to the control point
    expect(hitLayer(curved, { x: 50, y: 0 }, 3)).toBe(false);
    expect(hitLayer(counter("c", 1, 10, 10), { x: 18, y: 10 }, 0)).toBe(true);
    expect(hitLayer(counter("c", 1, 10, 10), { x: 25, y: 10 }, 0)).toBe(false);
    expect(hitLayer(redaction("r", 5, 5, 10, 10), { x: 8, y: 8 }, 0)).toBe(true);
  });
  it("never hits hidden or locked layers, and not what is inside hidden or locked groups", () => {
    const a = filledRect("a");
    expect(hitLayer({ ...a, visible: false }, { x: 5, y: 5 }, 0)).toBe(false);
    expect(hitLayer({ ...a, locked: true }, { x: 5, y: 5 }, 0)).toBe(false);
    expect(hitLayer(group("g", [a], { locked: true }), { x: 5, y: 5 }, 0)).toBe(false);
    expect(hitLayer(group("g", [a], { visible: false }), { x: 5, y: 5 }, 0)).toBe(false);
  });
  it("returns the topmost layer, a group as one unless asked to enter", () => {
    const layers = [
      filledRect("under"),
      group("g", [filledRect("inside")]),
      filledRect("far", 100, 100),
    ];
    expect(hitTest(layers, { x: 5, y: 5 }, 0)).toBe("g");
    expect(hitTest(layers, { x: 5, y: 5 }, 0, { enterGroups: true })).toBe("inside");
    expect(hitTest(layers, { x: 500, y: 5 }, 0)).toBeNull();
    expect(hitTest([filledRect("a"), filledRect("b")], { x: 5, y: 5 }, 0)).toBe("b");
  });
});

describe("moving", () => {
  it("translates every kind of layer and everything in a group", () => {
    const layers: Layer[] = [
      filledRect("a", 0, 0),
      counter("c", 1, 5, 5),
      redaction("r", 1, 2),
      { ...arrow("w"), style: "curved", curve: { x: 3, y: 3 } },
      {
        id: "p",
        visible: true,
        locked: false,
        type: "pencil",
        points: [0, 0, 1, 1],
        color: "#000000",
        width: 1,
        smoothing: 0,
      },
    ];
    const g = group("g", structuredClone(layers));
    translateLayer(g, 10, 20);
    const moved = g.layers;
    expect(moved[0]).toMatchObject({ x: 10, y: 20 });
    expect(moved[1]).toMatchObject({ x: 15, y: 25 });
    expect(moved[2]).toMatchObject({ rect: { x: 11, y: 22 } });
    expect(moved[3]).toMatchObject({
      from: { x: 10, y: 20 },
      to: { x: 20, y: 20 },
      curve: { x: 13, y: 23 },
    });
    expect(moved[4]).toMatchObject({ points: [10, 20, 11, 21] });
  });
  it("applies a box to the layers that have one", () => {
    const r = rect("a");
    applyBox(r, { x: 1, y: 2, width: 3, height: 4 });
    expect(r).toMatchObject({ x: 1, y: 2, width: 3, height: 4 });
    const red = redaction("r");
    applyBox(red, { x: 1, y: 2, width: 3, height: 4 });
    expect(red).toMatchObject({ rect: { x: 1, y: 2, width: 3, height: 4 } });
  });
});

describe("resizing a box", () => {
  const box = { x: 100, y: 100, width: 100, height: 50 };
  it("moves the dragged edge or corner and keeps the opposite one", () => {
    expect(resizeBox(box, "e", { x: 250, y: 999 })).toEqual({
      x: 100,
      y: 100,
      width: 150,
      height: 50,
    });
    expect(resizeBox(box, "nw", { x: 80, y: 90 })).toEqual({
      x: 80,
      y: 90,
      width: 120,
      height: 60,
    });
    expect(resizeBox(box, "s", { x: 0, y: 200 })).toEqual({
      x: 100,
      y: 100,
      width: 100,
      height: 100,
    });
  });
  it("stops at the minimum instead of flipping", () => {
    expect(resizeBox(box, "e", { x: 20, y: 0 }, { min: 4 })).toEqual({
      x: 100,
      y: 100,
      width: 4,
      height: 50,
    });
  });
  it("keeps the aspect ratio on a corner (Shift)", () => {
    const r = resizeBox(box, "se", { x: 300, y: 130 }, { keepAspect: true });
    expect(r.width / r.height).toBeCloseTo(2);
    expect([r.x, r.y]).toEqual([100, 100]);
    expect(r.width).toBe(200);
  });
  it("resizes around the centre (Alt)", () => {
    const r = resizeBox(box, "e", { x: 250, y: 0 }, { fromCenter: true });
    expect(r).toEqual({ x: 50, y: 100, width: 200, height: 50 });
  });
  it("keeps the opposite handle in place for a rotated box", () => {
    const rotation = 90;
    const center = { x: 150, y: 125 };
    // The "e" handle of a box turned by 90 degrees points down on the screen.
    const opposite = rotatePoint({ x: 100, y: 125 }, center, rotation); // the middle of the west edge
    const r = resizeBox(box, "e", rotatePoint({ x: 300, y: 125 }, center, rotation), { rotation });
    expect(r.width).toBeCloseTo(200);
    const newCenter = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    const newOpposite = rotatePoint({ x: r.x, y: newCenter.y }, newCenter, rotation);
    close(newOpposite.x, opposite.x, 4);
    close(newOpposite.y, opposite.y, 4);
  });
  it("measures the rotate handle angle (0 = up) and snaps it", () => {
    const c = { x: 0, y: 0 };
    close(angleAround(c, { x: 0, y: -10 }), 0);
    close(angleAround(c, { x: 10, y: 0 }), 90);
    expect(snapAngle(47, 15)).toBe(45);
    expect(snapAngle(-179, 15)).toBe(-180);
    expect(snapAngle(190, 15)).toBe(-165);
  });
});

describe("drawing constraints", () => {
  it("snaps an arrow to 45 degree steps keeping its length", () => {
    const end = constrainAngle({ x: 0, y: 0 }, { x: 100, y: 10 });
    close(end.x, Math.hypot(100, 10));
    close(end.y, 0);
    const diagonal = constrainAngle({ x: 0, y: 0 }, { x: 60, y: 50 });
    close(diagonal.x, diagonal.y);
  });
  it("makes a box square in every direction", () => {
    expect(constrainSquare({ x: 10, y: 10 }, { x: 60, y: 30 })).toEqual({ x: 60, y: 60 });
    expect(constrainSquare({ x: 10, y: 10 }, { x: 0, y: -40 })).toEqual({ x: -40, y: -40 });
  });
  it("numbers counters one above the highest, hidden and nested ones included", () => {
    expect(nextCounterValue([])).toBe(1);
    expect(
      nextCounterValue([
        counter("a", 1),
        { ...counter("b", 5), visible: false },
        group("g", [counter("c", 7)]),
      ]),
    ).toBe(8);
  });
  it("snaps to the nearest target within the threshold only", () => {
    expect(snapValue(98, [0, 100], 5)).toBe(100);
    expect(snapValue(50, [0, 100], 5)).toBe(50);
  });
  it("has a default curve for an arrow that stores none, and a polyline for it", () => {
    const c = arrowControl({ from: { x: 0, y: 0 }, to: { x: 100, y: 0 } });
    expect(c).toEqual({ x: 50, y: 20 });
    const pts = curvePoints({ x: 0, y: 0 }, c, { x: 100, y: 0 }, 4);
    expect(pts).toHaveLength(5);
    expect(pts[2]).toEqual({ x: 50, y: 10 });
  });
});

describe("crop", () => {
  const image = { width: 1000, height: 600 };
  it("keeps a rectangle inside the picture", () => {
    expect(clampRect({ x: -20, y: 580, width: 100, height: 100 }, image)).toEqual({
      x: 0,
      y: 500,
      width: 100,
      height: 100,
    });
    expect(clampRect({ x: 0, y: 0, width: 5000, height: 5000 }, image)).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 600,
    });
  });
  it("finds the largest centred rectangle of a ratio", () => {
    expect(fitAspect(image, 1)).toEqual({ x: 200, y: 0, width: 600, height: 600 });
    expect(fitAspect(image, 4 / 3)).toEqual({ x: 100, y: 0, width: 800, height: 600 });
    const wide = fitAspect(image, 4);
    expect([wide.width, wide.height, wide.y]).toEqual([1000, 250, 175]);
  });
  const crop = { x: 200, y: 100, width: 400, height: 300 };
  it("drags a free crop edge and keeps it in the picture", () => {
    expect(resizeCrop(crop, "e", { x: 700, y: 0 }, image)).toEqual({
      x: 200,
      y: 100,
      width: 500,
      height: 300,
    });
    expect(resizeCrop(crop, "e", { x: 5000, y: 0 }, image)).toEqual({
      x: 200,
      y: 100,
      width: 800,
      height: 300,
    });
    expect(resizeCrop(crop, "nw", { x: -50, y: -50 }, image)).toEqual({
      x: 0,
      y: 0,
      width: 600,
      height: 400,
    });
    expect(resizeCrop(crop, "w", { x: 599, y: 0 }, image, null, 8).width).toBe(8); // never smaller than the minimum
  });
  it("holds the ratio while dragging a corner or an edge", () => {
    const corner = resizeCrop(crop, "se", { x: 800, y: 300 }, image, 4 / 3);
    expect(corner.width / corner.height).toBeCloseTo(4 / 3);
    expect([corner.x, corner.y]).toEqual([200, 100]);
    const edge = resizeCrop(crop, "e", { x: 700, y: 0 }, image, 4 / 3);
    expect(edge.width / edge.height).toBeCloseTo(4 / 3);
    expect(edge.y + edge.height / 2).toBeCloseTo(250); // grows around the middle of the free axis
  });
  it("shrinks a locked-ratio crop that would leave the picture", () => {
    const r = resizeCrop(crop, "se", { x: 5000, y: 5000 }, image, 1);
    expect(r.x + r.width).toBeLessThanOrEqual(1000);
    expect(r.y + r.height).toBeLessThanOrEqual(600);
    expect(r.width / r.height).toBeCloseTo(1);
  });
});
