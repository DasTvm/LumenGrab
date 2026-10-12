import { describe, expect, it } from "vitest";
import { adjustImage, blurImage } from "./blur";
import { parseHex, toHex } from "./color";
import { linearLine, radialCircle, sortedStops } from "./gradient";
import { defaultMeshPoints, meshFieldSize, meshGrid, meshPoints, renderMeshField } from "./mesh";

describe("gradient geometry", () => {
  it("runs bottom to top at 0° and left to right at 90°, through the centre", () => {
    const up = linearLine(200, 100, 0);
    expect([up.x0, up.y0, up.x1, up.y1].map(Math.round)).toEqual([100, 100, 100, 0]);
    const right = linearLine(200, 100, 90);
    expect([right.x0, right.y0, right.x1, right.y1].map(Math.round)).toEqual([0, 50, 200, 50]);
  });

  it("is long enough at 45° for the corners to get the end colours", () => {
    const l = linearLine(100, 100, 45);
    expect(Math.hypot(l.x1 - l.x0, l.y1 - l.y0)).toBeCloseTo(100 * Math.SQRT2, 5);
  });

  it("reaches the farthest corner with a radial gradient and sorts stops stably", () => {
    expect(radialCircle(60, 80)).toEqual({ x: 30, y: 40, radius: 50 });
    const sorted = sortedStops([
      { offset: 1, color: "#000000" },
      { offset: 0.5, color: "#111111" },
      { offset: 0.5, color: "#222222" },
    ]);
    expect(sorted.map((s) => s.color)).toEqual(["#111111", "#222222", "#000000"]);
  });
});

describe("mesh", () => {
  const bg = {
    type: "mesh" as const,
    seed: 5,
    colors: ["#FF0000", "#00FF00", "#0000FF", "#FFFF00"],
  };

  it("lays out colours on a lattice, the same every time for a seed", () => {
    expect(meshGrid(9)).toEqual({ cols: 3, rows: 3 });
    expect(meshGrid(16)).toEqual({ cols: 4, rows: 4 });
    expect(meshGrid(5)).toEqual({ cols: 3, rows: 2 });
    const a = defaultMeshPoints(9, 1234);
    expect(defaultMeshPoints(9, 1234)).toEqual(a);
    expect(defaultMeshPoints(9, 1235)).not.toEqual(a);
    expect(a[0]).toEqual([0, 0]);
    expect(a[8]).toEqual([1, 1]);
    for (const [x, y] of a) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  it("uses explicit points when they match the colours, else the default layout", () => {
    expect(
      meshPoints({
        ...bg,
        points: [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ],
      })[3],
    ).toEqual([1, 1]);
    expect(meshPoints({ ...bg, points: [[0, 0]] })).toEqual(defaultMeshPoints(4, 5));
  });

  it("renders deterministic opaque fields that are the colour of the nearest point at a point", () => {
    const a = renderMeshField(
      {
        ...bg,
        points: [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ],
      },
      32,
      32,
    );
    expect(
      renderMeshField(
        {
          ...bg,
          points: [
            [0, 0],
            [1, 0],
            [0, 1],
            [1, 1],
          ],
        },
        32,
        32,
      ),
    ).toEqual(a);
    expect(a[3]).toBe(255);
    expect(a[0]).toBeGreaterThan(200); // top-left is red
    expect(a[(31 * 32 + 31) * 4 + 0]).toBeGreaterThan(150); // bottom-right is yellow (red + green)
    expect(a[(31 * 32 + 31) * 4 + 2]).toBeLessThan(80);
  });

  it("sizes the field at an eighth of the canvas within 8 and 256 samples", () => {
    expect(meshFieldSize(800, 400)).toEqual({ width: 100, height: 50 });
    expect(meshFieldSize(8000, 4000)).toEqual({ width: 256, height: 128 });
    expect(meshFieldSize(10, 10)).toEqual({ width: 8, height: 8 });
  });
});

describe("blur and adjust", () => {
  const image = (w: number, h: number, f: (x: number, y: number) => number) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) data.set([f(x, y), f(x, y), f(x, y), 255], (y * w + x) * 4);
    return { width: w, height: h, data };
  };

  it("spreads a bright pixel and keeps the average", () => {
    const src = image(21, 21, (x, y) => (x === 10 && y === 10 ? 255 : 0));
    const out = blurImage(src, 3);
    expect(out.data[(10 * 21 + 10) * 4]).toBeLessThan(40);
    expect(out.data[(10 * 21 + 12) * 4]).toBeGreaterThan(0);
    const sum = (img: { data: Uint8ClampedArray }) =>
      Array.from(img.data).reduce((n, v, i) => (i % 4 === 0 ? n + v : n), 0);
    expect(Math.abs(sum(out) - 255)).toBeLessThan(25);
  });

  it("does not fade the border (edges are clamped) and leaves a flat picture flat", () => {
    const out = blurImage(
      image(16, 16, () => 200),
      4,
    );
    for (let i = 0; i < out.data.length; i += 4) expect(out.data[i]).toBe(200);
  });

  it("returns the same image for a negligible sigma", () => {
    const src = image(4, 4, () => 7);
    expect(blurImage(src, 0)).toBe(src);
  });

  it("changes saturation and dims", () => {
    const img = { width: 1, height: 1, data: new Uint8ClampedArray([200, 100, 50, 255]) };
    adjustImage(img, 0, 0.5);
    const [r, g, b] = img.data;
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeGreaterThan(40);
    expect(r).toBeLessThan(80);
  });
});

describe("colour helpers", () => {
  it("parses and prints hex", () => {
    expect(parseHex("#84CC16")).toEqual([0x84, 0xcc, 0x16, 1]);
    expect(parseHex("#00000080")[3]).toBeCloseTo(0.5, 2);
    expect(parseHex("nope")).toEqual([0, 0, 0, 1]);
    expect(toHex([132, 204, 22])).toBe("#84CC16");
  });
});
