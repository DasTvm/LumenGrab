import { describe, expect, it } from "vitest";
import type { Redaction } from "../schema";
import { asImage, stripes } from "../testing/png";
import {
  applyRedaction,
  applyRedactions,
  clampRect,
  cloneImage,
  cropImage,
  downscaleImage,
  MIN_BLUR_RADIUS,
  MIN_PIXEL_BLOCK,
  seededRandom,
  type RgbaImage,
} from "./pixels";

const redaction = (over: Partial<Redaction>): Redaction => ({
  id: "r",
  type: "redaction",
  visible: true,
  locked: false,
  mode: "solid",
  rect: { x: 8, y: 8, width: 24, height: 16 },
  strength: 8,
  seed: 1234,
  ...over,
});

const picture = (): RgbaImage => asImage(stripes(64, 48));

/** Every pixel inside `rect` differs from `before` in at least one colour channel. */
function everyPixelChanged(
  before: RgbaImage,
  after: RgbaImage,
  rect: { x: number; y: number; width: number; height: number },
) {
  let unchanged = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const at = (y * before.width + x) * 4;
      const same = [0, 1, 2].every(
        (c) => Math.abs((before.data[at + c] ?? 0) - (after.data[at + c] ?? 0)) < 1,
      );
      if (same) unchanged += 1;
    }
  }
  return unchanged;
}

/** Everything outside `rect` is byte-identical. */
function outsideUntouched(
  before: RgbaImage,
  after: RgbaImage,
  rect: { x: number; y: number; width: number; height: number },
) {
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const inside =
        x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
      if (inside) continue;
      const at = (y * before.width + x) * 4;
      for (let c = 0; c < 4; c += 1) if (before.data[at + c] !== after.data[at + c]) return false;
    }
  }
  return true;
}

describe("redactions destroy the pixels", () => {
  const rect = { x: 8, y: 8, width: 24, height: 16 };

  it("solid: an opaque fill, even if the colour has alpha and the source was transparent", () => {
    const before = picture();
    before.data.fill(0); // fully transparent source
    const after = cloneImage(before);
    applyRedaction(after, redaction({ mode: "solid", color: "#FF000010" }));
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        const at = (y * after.width + x) * 4;
        expect([...after.data.subarray(at, at + 4)]).toEqual([255, 0, 0, 255]);
      }
    }
    expect(outsideUntouched(before, after, rect)).toBe(true);
  });

  it("solid without a colour is black, not see-through", () => {
    const after = picture();
    applyRedaction(after, redaction({ mode: "solid" }));
    const at = (10 * after.width + 10) * 4;
    expect([...after.data.subarray(at, at + 4)]).toEqual([0, 0, 0, 255]);
  });

  it("blur: changes every pixel of a high-contrast pattern and nothing outside, even with a tiny strength", () => {
    for (const strength of [0, 1, 3, 10]) {
      const before = picture();
      const after = cloneImage(before);
      applyRedaction(after, redaction({ mode: "blur", strength }));
      expect(everyPixelChanged(before, after, rect), `strength ${String(strength)}`).toBe(0);
      expect(outsideUntouched(before, after, rect)).toBe(true);
    }
  });

  it("blur: the detail is really gone (the pattern's edges are smoothed away)", () => {
    const before = picture();
    const after = cloneImage(before);
    applyRedaction(after, redaction({ mode: "blur", strength: MIN_BLUR_RADIUS }));
    const energy = (img: RgbaImage) => {
      let sum = 0;
      for (let y = rect.y; y < rect.y + rect.height; y += 1) {
        for (let x = rect.x; x < rect.x + rect.width - 1; x += 1) {
          const at = (y * img.width + x) * 4;
          sum += Math.abs((img.data[at] ?? 0) - (img.data[at + 4] ?? 0));
        }
      }
      return sum;
    };
    expect(energy(after)).toBeLessThan(energy(before) * 0.1);
  });

  it("blur: nothing from outside the rectangle flows in (the result depends only on the pixels inside)", () => {
    const a = picture();
    const b = cloneImage(a);
    for (let y = 0; y < b.height; y += 1) {
      for (let x = 0; x < b.width; x += 1) {
        const inside =
          x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
        if (!inside) b.data.set([255, 255, 255, 255], (y * b.width + x) * 4);
      }
    }
    applyRedaction(a, redaction({ mode: "blur", strength: 10 }));
    applyRedaction(b, redaction({ mode: "blur", strength: 10 }));
    for (let y = rect.y; y < rect.y + rect.height; y += 1) {
      for (let x = rect.x; x < rect.x + rect.width; x += 1) {
        const at = (y * a.width + x) * 4;
        expect([...a.data.subarray(at, at + 4)]).toEqual([...b.data.subarray(at, at + 4)]);
      }
    }
  });

  it("pixelate: changes every pixel, nothing outside, blocks are flat", () => {
    const before = picture();
    const after = cloneImage(before);
    applyRedaction(after, redaction({ mode: "pixelate", strength: 8 }));
    expect(everyPixelChanged(before, after, rect)).toBe(0);
    expect(outsideUntouched(before, after, rect)).toBe(true);
    const first = (rect.y * after.width + rect.x) * 4;
    const inside = (rect.y * after.width + rect.x + 7) * 4;
    expect([...after.data.subarray(first, first + 4)]).toEqual([
      ...after.data.subarray(inside, inside + 4),
    ]);
  });

  it("pixelate: the same seed gives the same pixels, another seed gives other pixels", () => {
    const run = (seed: number) => {
      const image = picture();
      applyRedaction(image, redaction({ mode: "pixelate", strength: 8, seed }));
      return image.data;
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7)).not.toEqual(run(8));
  });

  it("pixelate: is not just the block average (the seeded noise and sample are part of it)", () => {
    const before = picture();
    const after = cloneImage(before);
    applyRedaction(after, redaction({ mode: "pixelate", strength: 8, seed: 99 }));
    let sum = [0, 0, 0];
    for (let y = 8; y < 16; y += 1) {
      for (let x = 8; x < 16; x += 1) {
        const at = (y * before.width + x) * 4;
        sum = sum.map((v, c) => v + (before.data[at + c] ?? 0));
      }
    }
    const average = sum.map((v) => v / 64);
    const at = (8 * after.width + 8) * 4;
    const result = [after.data[at] ?? 0, after.data[at + 1] ?? 0, after.data[at + 2] ?? 0];
    expect(result.some((v, c) => Math.abs(v - (average[c] ?? 0)) > 0.5)).toBe(true);
  });

  it("pixelate: a block size below the minimum is raised to it", () => {
    const image = picture();
    applyRedaction(image, redaction({ mode: "pixelate", strength: 1 }));
    const at = (8 * image.width + 8) * 4;
    const sameBlock = (8 * image.width + 8 + MIN_PIXEL_BLOCK - 1) * 4;
    const nextBlock = (8 * image.width + 8 + MIN_PIXEL_BLOCK) * 4;
    expect([...image.data.subarray(at, at + 4)]).toEqual([
      ...image.data.subarray(sameBlock, sameBlock + 4),
    ]);
    expect([...image.data.subarray(at, at + 4)]).not.toEqual([
      ...image.data.subarray(nextBlock, nextBlock + 4),
    ]);
  });

  it("ignores a redaction that lies outside the picture and clamps one that sticks out", () => {
    const before = picture();
    const after = cloneImage(before);
    applyRedaction(after, redaction({ rect: { x: 500, y: 500, width: 10, height: 10 } }));
    expect(after.data).toEqual(before.data);
    applyRedaction(after, redaction({ rect: { x: 56, y: 40, width: 100, height: 100 } }));
    const corner = (47 * after.width + 63) * 4;
    expect([...after.data.subarray(corner, corner + 4)]).toEqual([0, 0, 0, 255]);
  });

  it("applyRedactions skips hidden layers and non-redaction layers", () => {
    const image = picture();
    const before = cloneImage(image);
    applyRedactions(image, [
      redaction({ visible: false }),
      { id: "x", type: "stamp", visible: true },
      {
        id: "a",
        type: "counter",
        visible: true,
        locked: false,
        x: 1,
        y: 1,
        value: 1,
        color: "#000000",
        size: 10,
      },
    ]);
    expect(image.data).toEqual(before.data);
    applyRedactions(image, [redaction({ mode: "solid", color: "#00FF00" })]);
    expect(image.data).not.toEqual(before.data);
  });
});

describe("crop and downscale", () => {
  it("clamps a rectangle to the picture and drops one that is outside", () => {
    expect(clampRect({ x: -5, y: -5, width: 20, height: 20 }, 64, 48)).toEqual({
      x: 0,
      y: 0,
      width: 15,
      height: 15,
    });
    expect(clampRect({ x: 60, y: 40, width: 100, height: 100 }, 64, 48)).toEqual({
      x: 60,
      y: 40,
      width: 4,
      height: 8,
    });
    expect(clampRect({ x: 70, y: 0, width: 5, height: 5 }, 64, 48)).toBeNull();
    expect(clampRect({ x: 1.4, y: 1.4, width: 2.2, height: 2.2 }, 64, 48)).toEqual({
      x: 1,
      y: 1,
      width: 3,
      height: 3,
    });
  });

  it("crops to the rectangle and keeps the pixels", () => {
    const image = picture();
    const cropped = cropImage(image, { x: 4, y: 2, width: 10, height: 6 });
    expect([cropped.width, cropped.height]).toEqual([10, 6]);
    const from = (2 * image.width + 4) * 4;
    expect([...cropped.data.subarray(0, 4)]).toEqual([...image.data.subarray(from, from + 4)]);
  });

  it("returns the whole picture for no crop or a crop that is outside", () => {
    const image = picture();
    expect(cropImage(image, null)).toBe(image);
    expect(cropImage(image, { x: 900, y: 900, width: 5, height: 5 })).toBe(image);
  });

  it("scales down to the longest edge, keeps the aspect ratio and never scales up", () => {
    const big = asImage(stripes(3000, 1000));
    const small = downscaleImage(big, 1024);
    expect([small.width, small.height]).toEqual([1024, 341]);
    expect(downscaleImage(picture(), 1024).width).toBe(64);
    const tall = downscaleImage(asImage(stripes(100, 400)), 100);
    expect([tall.width, tall.height]).toEqual([25, 100]);
  });

  it("averages the blocks it merges", () => {
    const data = new Uint8ClampedArray([
      0, 0, 0, 255, 200, 100, 50, 255, 0, 0, 0, 255, 200, 100, 50, 255,
    ]);
    const out = downscaleImage({ width: 4, height: 1, data: new Uint8ClampedArray([...data]) }, 2);
    expect([...out.data]).toEqual([100, 50, 25, 255, 100, 50, 25, 255]);
  });
});

describe("seededRandom", () => {
  it("repeats for the same seed and stays in [0, 1)", () => {
    const a = seededRandom(5);
    const b = seededRandom(5);
    for (let i = 0; i < 100; i += 1) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(seededRandom(5)()).not.toBe(seededRandom(6)());
  });
});
