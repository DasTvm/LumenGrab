import { describe, expect, it } from "vitest";
import type { PixelRect } from "@/platform";
import {
  clampPoint,
  cssPointToPixelPoint,
  cssRectToPixelRect,
  hitTestWindow,
  isSelectionBigEnough,
  MIN_SELECTION_CSS_PX,
  normalizeRect,
  pixelRectToCssRect,
} from "./geometry";

describe("normalizeRect", () => {
  it("is independent of drag direction", () => {
    const expected = { x: 10, y: 20, width: 100, height: 50 };
    expect(normalizeRect({ x: 10, y: 20 }, { x: 110, y: 70 })).toEqual(expected);
    expect(normalizeRect({ x: 110, y: 70 }, { x: 10, y: 20 })).toEqual(expected);
    expect(normalizeRect({ x: 110, y: 20 }, { x: 10, y: 70 })).toEqual(expected);
    expect(normalizeRect({ x: 10, y: 70 }, { x: 110, y: 20 })).toEqual(expected);
  });
});

describe("clampPoint", () => {
  it("keeps the pointer inside the display, also when dragging past an edge", () => {
    const size = { width: 800, height: 600 };
    expect(clampPoint({ x: -20, y: 900 }, size)).toEqual({ x: 0, y: 600 });
    expect(clampPoint({ x: 400, y: 300 }, size)).toEqual({ x: 400, y: 300 });
  });
});

describe("isSelectionBigEnough", () => {
  it("ignores tiny selections (accidental clicks) on either edge", () => {
    const edge = MIN_SELECTION_CSS_PX;
    expect(isSelectionBigEnough({ x: 0, y: 0, width: edge, height: edge })).toBe(true);
    expect(isSelectionBigEnough({ x: 0, y: 0, width: edge - 0.1, height: 100 })).toBe(false);
    expect(isSelectionBigEnough({ x: 0, y: 0, width: 100, height: edge - 0.1 })).toBe(false);
    expect(isSelectionBigEnough({ x: 5, y: 5, width: 0, height: 0 })).toBe(false);
  });
});

describe("cssRectToPixelRect", () => {
  it("2x display: a 400x300 CSS drag is exactly 800x600 pixels", () => {
    const css = { width: 1920, height: 1243 };
    const px = { width: 3840, height: 2486 };
    expect(cssRectToPixelRect({ x: 100, y: 50, width: 400, height: 300 }, css, px)).toEqual({
      x: 200,
      y: 100,
      width: 800,
      height: 600,
    });
  });

  it("150% Windows display: fractional CSS edges still give exact pixel sizes", () => {
    // 1280x720 CSS (what the webview sees at 150%) over a 1920x1080 frame.
    const css = { width: 1280, height: 720 };
    const px = { width: 1920, height: 1080 };
    const r = cssRectToPixelRect(
      { x: 100 / 1.5, y: 30 / 1.5, width: 400 / 1.5, height: 300 / 1.5 },
      css,
      px,
    );
    expect(r).toEqual({ x: 100, y: 30, width: 400, height: 300 });
  });

  it("100% display is the identity", () => {
    const size = { width: 1920, height: 1080 };
    expect(cssRectToPixelRect({ x: 7, y: 9, width: 11, height: 13 }, size, size)).toEqual({
      x: 7,
      y: 9,
      width: 11,
      height: 13,
    });
  });

  it("odd ratio (CSS 1707x960 over 2560x1440) maps edges to the nearest pixel and never leaves the frame", () => {
    const css = { width: 1707, height: 960 };
    const px = { width: 2560, height: 1440 };
    const full = cssRectToPixelRect({ x: 0, y: 0, width: 1707, height: 960 }, css, px);
    expect(full).toEqual({ x: 0, y: 0, width: 2560, height: 1440 });
    const r = cssRectToPixelRect({ x: 1000.3, y: 500.7, width: 800, height: 600 }, css, px);
    expect(r.x + r.width).toBeLessThanOrEqual(2560);
    expect(r.y + r.height).toBeLessThanOrEqual(1440);
  });

  it("clamps selections that extend past the display edges", () => {
    const css = { width: 100, height: 100 };
    const px = { width: 200, height: 200 };
    expect(cssRectToPixelRect({ x: 80, y: 90, width: 100, height: 100 }, css, px)).toEqual({
      x: 160,
      y: 180,
      width: 40,
      height: 20,
    });
    expect(cssRectToPixelRect({ x: -10, y: -10, width: 30, height: 30 }, css, px)).toEqual({
      x: 0,
      y: 0,
      width: 40,
      height: 40,
    });
  });
});

describe("pixel <-> css conversion", () => {
  it("round-trips a window frame", () => {
    const css = { width: 720, height: 450 };
    const px = { width: 1440, height: 900 };
    const window = { x: 120, y: 90, width: 1200, height: 720 };
    expect(pixelRectToCssRect(window, css, px)).toEqual({ x: 60, y: 45, width: 600, height: 360 });
    expect(cssPointToPixelPoint({ x: 60, y: 45 }, css, px)).toEqual({ x: 120, y: 90 });
  });
});

describe("hitTestWindow", () => {
  const windows = [
    { id: 1, x: 100, y: 100, width: 200, height: 200 }, // front
    { id: 2, x: 0, y: 0, width: 500, height: 500 }, // back
  ];

  it("returns the frontmost window under the pointer", () => {
    expect(hitTestWindow(windows, { x: 150, y: 150 })?.id).toBe(1);
    expect(hitTestWindow(windows, { x: 10, y: 10 })?.id).toBe(2);
  });

  it("includes the top-left edge and excludes the bottom-right edge", () => {
    expect(hitTestWindow(windows, { x: 100, y: 100 })?.id).toBe(1);
    expect(hitTestWindow(windows, { x: 300, y: 300 })?.id).toBe(2); // just outside window 1
    expect(hitTestWindow(windows, { x: 500, y: 500 })).toBeUndefined();
  });

  it("returns undefined when nothing is under the pointer", () => {
    const none: PixelRect[] = [];
    expect(hitTestWindow(none, { x: 1, y: 1 })).toBeUndefined();
  });
});
