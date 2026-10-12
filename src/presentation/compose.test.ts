import { describe, expect, it } from "vitest";
import { defaultPresentation } from "@/document/write";
import {
  balancedPadding,
  barHeight,
  computeLayout,
  fitBox,
  frameScale,
  MAX_OUTPUT_EDGE,
} from "./compose";

const make = (patch: Record<string, unknown> = {}) => ({ ...defaultPresentation(), ...patch });

describe("computeLayout", () => {
  it("adds the padding on every side and keeps the picture where the padding puts it", () => {
    const l = computeLayout(
      { width: 400, height: 300 },
      make({ padding: { top: 10, right: 20, bottom: 30, left: 40 } }),
    );
    expect(l.canvas).toEqual({ width: 460, height: 340 });
    expect(l.unit).toEqual({ x: 40, y: 10, width: 400, height: 300 });
    expect(l.contentBox).toEqual(l.unit);
    expect(l.output).toEqual({ width: 460, height: 340 });
    expect(l.scale).toBe(1);
  });

  it("puts a frame's title bar above the picture and scales it with the picture width", () => {
    const l = computeLayout(
      { width: 1280, height: 720 },
      make({ frame: { type: "macos-window" } }),
    );
    expect(l.bar).toBe(40);
    expect(l.unit.height).toBe(760);
    expect(l.contentBox).toMatchObject({ y: l.unit.y + 40, height: 720 });
    expect(barHeight("macos-window", 2560)).toBe(80);
    expect(barHeight("macos-window", 100)).toBe(20);
    expect(barHeight("none", 2560)).toBe(0);
    expect(frameScale(100000)).toBe(4);
  });

  it("widens or heightens the canvas to the aspect ratio and never shrinks it", () => {
    const wide = computeLayout(
      { width: 400, height: 300 },
      make({
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        aspect: { mode: "fixed", ratio: [16, 9] },
      }),
    );
    expect(wide.canvas).toEqual({ width: 533, height: 300 });
    expect(wide.unit.x).toBeCloseTo(66.5);
    const tall = computeLayout(
      { width: 400, height: 300 },
      make({
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        aspect: { mode: "fixed", ratio: [1, 1] },
      }),
    );
    expect(tall.canvas).toEqual({ width: 400, height: 400 });
    expect(tall.unit.y).toBe(50);
  });

  it("exports a social format at exactly its size", () => {
    const l = computeLayout(
      { width: 1280, height: 720 },
      make({
        padding: { top: 64, right: 64, bottom: 64, left: 64 },
        aspect: { mode: "fixed", ratio: [9, 16], size: [1080, 1920], preset: "instagram-story" },
      }),
    );
    expect(l.output).toEqual({ width: 1080, height: 1920 });
    expect(l.canvas.width / l.canvas.height).toBeCloseTo(9 / 16, 3);
    expect(l.scale).toBeCloseTo(1080 / l.canvas.width, 6);
  });

  it("applies the export scale and clamps the output to 16 384 px", () => {
    expect(computeLayout({ width: 100, height: 100 }, make({ exportScale: 2 })).output).toEqual({
      width: 456,
      height: 456,
    });
    const big = computeLayout({ width: 10000, height: 4000 }, make({ exportScale: 4 }));
    expect(big.clamped).toBe(true);
    expect(Math.max(big.output.width, big.output.height)).toBe(MAX_OUTPUT_EDGE);
  });

  it("limits the corner radius to half the window", () => {
    expect(computeLayout({ width: 40, height: 20 }, make({ cornerRadius: 500 })).radius).toBe(10);
  });
});

describe("fitBox and balancedPadding", () => {
  it("covers or contains, centred", () => {
    expect(fitBox({ width: 100, height: 50 }, { width: 100, height: 100 }, "cover")).toEqual({
      x: -50,
      y: 0,
      width: 200,
      height: 100,
    });
    expect(fitBox({ width: 100, height: 50 }, { width: 100, height: 100 }, "contain")).toEqual({
      x: 0,
      y: 25,
      width: 100,
      height: 50,
    });
    expect(fitBox({ width: 100, height: 100 }, { width: 100, height: 100 }, "cover", 2)).toEqual({
      x: -50,
      y: -50,
      width: 200,
      height: 200,
    });
  });

  it("gives every edge the mean of the four", () => {
    expect(balancedPadding({ top: 20, right: 58, bottom: 28, left: 40 })).toEqual({
      top: 37,
      right: 37,
      bottom: 37,
      left: 37,
    });
  });
});
