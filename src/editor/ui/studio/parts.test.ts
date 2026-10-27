import { describe, expect, it } from "vitest";
import { placeMenu } from "./parts";

const VIEW = { width: 1000, height: 700 };
const at = (left: number, top: number, w = 24, h = 24) => ({
  left,
  right: left + w,
  top,
  bottom: top + h,
});

describe("placeMenu", () => {
  it("goes below the button, lined up with its right edge", () => {
    const p = placeMenu(at(500, 100), { width: 168, height: 160 }, VIEW, {
      side: "below",
      align: "end",
    });
    expect(p.top).toBe(100 + 24 + 6);
    expect(p.left).toBe(500 + 24 - 168);
  });

  it("is moved right when the button is at the left edge of the window (the tile at the far left)", () => {
    const p = placeMenu(at(12, 100, 90, 90), { width: 168, height: 160 }, VIEW, {
      side: "below",
      align: "end",
    });
    expect(p.left).toBe(8);
  });

  it("is moved left when it would run out of the window on the right", () => {
    const p = placeMenu(at(950, 100), { width: 256, height: 100 }, VIEW, {
      side: "below",
      align: "start",
    });
    expect(p.left).toBe(1000 - 256 - 8);
  });

  it("opens above the button when there is no room below (the last row of a list)", () => {
    const p = placeMenu(at(500, 600), { width: 168, height: 160 }, VIEW, {
      side: "below",
      align: "end",
    });
    expect(p.top + 160).toBeLessThanOrEqual(600 - 6);
    expect(p.top).toBeGreaterThanOrEqual(8);
  });

  it("stays on the wanted side while it fits, and is cut to the room when neither side holds it", () => {
    const above = placeMenu(at(500, 600), { width: 168, height: 100 }, VIEW, {
      side: "above",
      align: "end",
    });
    expect(above.top).toBe(600 - 6 - 100);
    const tight = placeMenu(at(500, 300), { width: 168, height: 900 }, VIEW, {
      side: "below",
      align: "end",
    });
    expect(tight.maxHeight).toBeLessThanOrEqual(700 - 8 - 8);
  });
});
