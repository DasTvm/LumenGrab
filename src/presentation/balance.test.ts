import { describe, expect, it } from "vitest";
import type { RgbaImage } from "@/document/render/pixels";
import { balanceCrop, cropForKeep, emptyColor, findMargins, measureEdges } from "./balance";

/** A `w x h` picture of `bg` with a `box` (x, y, w, h) of dark pixels and optional noise on the background. */
function picture(
  w: number,
  h: number,
  box: [number, number, number, number],
  bg: [number, number, number, number] = [255, 255, 255, 255],
  noise = 0,
): RgbaImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const inside = x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3];
      const jitter = noise ? ((x * 7 + y * 13) % (noise * 2 + 1)) - noise : 0;
      const value: number[] = inside
        ? [20, 30, 40, 255]
        : [bg[0] + jitter, bg[1] + jitter, bg[2] + jitter, bg[3]];
      data.set(value, (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

describe("finding the empty edges", () => {
  it("measures the empty space on each side", () => {
    const image = picture(100, 60, [10, 5, 50, 40]); // content x 10..60, y 5..45
    expect(findMargins(image)).toEqual({ top: 5, left: 10, right: 40, bottom: 15 });
  });

  it("works on a transparent background and ignores small noise", () => {
    expect(findMargins(picture(100, 60, [10, 5, 50, 40], [0, 0, 0, 0]))).toEqual({
      top: 5,
      left: 10,
      right: 40,
      bottom: 15,
    });
    expect(findMargins(picture(100, 60, [10, 5, 50, 40], [250, 250, 250, 255], 4))).toEqual({
      top: 5,
      left: 10,
      right: 40,
      bottom: 15,
    });
  });

  it("finds nothing when the picture is one colour, or when the corners disagree", () => {
    expect(findMargins(picture(20, 20, [0, 0, 20, 20]))).toBeNull(); // content to the edges: one colour
    expect(findMargins(picture(20, 20, [0, 0, 0, 0]))).toBeNull(); // all empty
    const odd = picture(20, 20, [5, 5, 10, 10]);
    odd.data.set([255, 0, 0, 255], 0); // top left red
    odd.data.set([0, 0, 255, 255], (19 * 20 + 19) * 4); // bottom right blue
    odd.data.set([0, 255, 0, 255], 19 * 4); // top right green
    expect(emptyColor(odd)).toBeNull(); // no two corners agree
    expect(findMargins(odd)).toBeNull();
    expect(findMargins({ width: 1, height: 1, data: new Uint8ClampedArray(4) })).toBeNull();
  });
});

describe("the crop that balances the edges", () => {
  it("leaves the smaller margin of each axis on both of its sides", () => {
    const image = picture(100, 60, [10, 5, 50, 40]); // left 10, top 5, right 40, bottom 15
    const measured = measureEdges(image, null);
    expect(measured?.keep).toEqual({ x: 10, y: 5 });
    expect(measured?.maxKeep).toEqual({ x: 40, y: 15 });
    // Horizontal: right 40 -> 10 (left stays 10). Vertical: bottom 15 -> 5 (top stays 5).
    expect(balanceCrop(image, null)).toEqual({ x: 0, y: 0, width: 70, height: 50 });
  });

  it("copies from the other axis when a side touches the edge, instead of cutting at the content", () => {
    // Content touches the left edge (margin 0); the others are top 6, right 30, bottom 14.
    const image = picture(100, 60, [0, 6, 70, 40]);
    const measured = measureEdges(image, null);
    expect(measured?.margins).toEqual({ left: 0, top: 6, right: 30, bottom: 14 });
    // Vertical has two real margins: 6. Horizontal has a side with none, so it takes 6 as well.
    expect(measured?.keep).toEqual({ x: 6, y: 6 });
    expect(balanceCrop(image, null)).toEqual({ x: 0, y: 0, width: 76, height: 52 });
  });

  it("keeps a generous horizontal margin when only the vertical one is small", () => {
    // left 30, right 30, top 4, bottom 4 (a wide strip): horizontal keeps 30, vertical keeps 4.
    const image = picture(100, 40, [30, 4, 40, 32]);
    const measured = measureEdges(image, null);
    expect(measured?.keep).toEqual({ x: 30, y: 4 });
    expect(balanceCrop(image, null)).toBeNull(); // already as small as it can be
  });

  it("can leave other space per axis, and never cuts into the content", () => {
    const image = picture(100, 60, [10, 5, 50, 40]);
    const measured = measureEdges(image, null);
    if (!measured) throw new Error("no margins");
    expect(cropForKeep(measured, { x: 0, y: 0 })).toEqual({ x: 10, y: 5, width: 50, height: 40 }); // hard at the content
    expect(cropForKeep(measured, { x: 20, y: 0 })).toEqual({ x: 0, y: 5, width: 80, height: 40 }); // only the sides
    expect(cropForKeep(measured, { x: 0, y: 12 })).toEqual({ x: 10, y: 0, width: 50, height: 57 });
    expect(cropForKeep(measured, { x: 999, y: 999 })).toEqual({
      x: 0,
      y: 0,
      width: 100,
      height: 60,
    }); // everything
  });

  it("is null when the edges are already as small as they can be, or there is no empty edge", () => {
    expect(balanceCrop(picture(60, 40, [10, 10, 40, 20]), null)).toBeNull();
    expect(balanceCrop(picture(20, 20, [0, 0, 20, 20]), null)).toBeNull();
  });

  it("measures inside an existing crop and answers in source pixels", () => {
    const image = picture(100, 60, [10, 5, 50, 40]);
    const area = { x: 4, y: 2, width: 90, height: 50 };
    // In the crop the margins are left 6, top 3, right 34, bottom 7: horizontal keeps 6, vertical 3.
    expect(balanceCrop(image, area)).toEqual({ x: 4, y: 2, width: 62, height: 46 });
  });
});
