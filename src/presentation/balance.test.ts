import { describe, expect, it } from "vitest";
import type { RgbaImage } from "@/document/render/pixels";
import { balanceCrop, emptyColor, findMargins } from "./balance";

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
  it("keeps the smallest margin on every side", () => {
    const image = picture(100, 60, [10, 5, 50, 40]);
    // Smallest margin is 5 (top): left 10 -> 5, right 40 -> 5, bottom 15 -> 5.
    expect(balanceCrop(image, null)).toEqual({ x: 5, y: 0, width: 60, height: 50 });
  });

  it("is null when the edges are already equal or there is no empty edge", () => {
    expect(balanceCrop(picture(60, 40, [10, 10, 40, 20]), null)).toBeNull();
    expect(balanceCrop(picture(20, 20, [0, 0, 20, 20]), null)).toBeNull();
  });

  it("measures inside an existing crop and answers in source pixels", () => {
    const image = picture(100, 60, [10, 5, 50, 40]);
    const area = { x: 4, y: 2, width: 90, height: 50 };
    // In the crop the margins are top 3, left 6, right 34, bottom 7: the smallest is 3.
    expect(balanceCrop(image, area)).toEqual({ x: 7, y: 2, width: 56, height: 46 });
  });
});
