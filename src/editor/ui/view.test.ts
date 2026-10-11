import { describe, expect, it } from "vitest";
import {
  centerView,
  clampZoom,
  fitView,
  MAX_ZOOM,
  stepZoom,
  toImage,
  toScreen,
  wheelZoom,
  zoomAt,
  zoomLabel,
} from "./view";

const area = { width: 896, height: 824 };

describe("view", () => {
  it("converts between image and screen and back", () => {
    const view = { zoom: 2, x: 100, y: 50 };
    expect(toScreen(view, { x: 10, y: 20 })).toEqual({ x: 120, y: 90 });
    expect(toImage(view, toScreen(view, { x: 33, y: -7 }))).toEqual({ x: 33, y: -7 });
  });

  it("fits a picture into the area with a margin, never bigger than 100 %", () => {
    const big = fitView(area, { x: 0, y: 0, width: 3000, height: 1000 });
    expect(big.zoom).toBeCloseTo((896 - 96) / 3000);
    expect(big.x).toBeCloseTo(48);
    const small = fitView(area, { x: 0, y: 0, width: 200, height: 100 });
    expect(small.zoom).toBe(1);
    expect(small.x).toBe((896 - 200) / 2);
    expect(small.y).toBe((824 - 100) / 2);
  });

  it("centres a crop rectangle, not the whole picture", () => {
    const view = centerView(area, { x: 100, y: 50, width: 200, height: 100 }, 1);
    expect(toScreen(view, { x: 200, y: 100 })).toEqual({ x: 448, y: 412 });
  });

  it("zooms around a point: that point does not move on the screen", () => {
    const view = { zoom: 1, x: 40, y: 30 };
    const anchor = { x: 300, y: 200 };
    const before = toImage(view, anchor);
    const next = zoomAt(view, anchor, 3);
    expect(next.zoom).toBe(3);
    const after = toImage(next, anchor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("limits the zoom", () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0)).toBeGreaterThan(0);
    expect(zoomAt({ zoom: 1, x: 0, y: 0 }, { x: 0, y: 0 }, 99).zoom).toBe(MAX_ZOOM);
  });

  it("steps through the zoom levels the buttons offer", () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(0.4, 1)).toBe(0.5);
    expect(stepZoom(0.4, -1)).toBe(0.33);
    expect(stepZoom(16, 1)).toBe(16);
  });

  it("zooms in on wheel up and out on wheel down, a pinch faster", () => {
    expect(wheelZoom(1, -100, false)).toBeGreaterThan(1);
    expect(wheelZoom(1, 100, false)).toBeLessThan(1);
    expect(wheelZoom(1, -10, true)).toBeGreaterThan(wheelZoom(1, -10, false));
  });

  it("labels the zoom", () => {
    expect(zoomLabel(0.4)).toBe("40%");
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(12.5)).toBe("1,250%");
  });
});
