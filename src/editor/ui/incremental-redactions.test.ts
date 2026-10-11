import { describe, expect, it } from "vitest";
import type { Layer, Redaction } from "@/document/schema";
import { applyRedactions, cloneImage, type RgbaImage } from "@/document/render/pixels";
import { IncrementalRedactions } from "./incremental-redactions";
import { group, rect } from "../model/test-layers";

function picture(width: number, height: number): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i * 4);
  }
  return { width, height, data };
}

let counter = 0;
const red = (
  id: string,
  mode: Redaction["mode"],
  x: number,
  y: number,
  w: number,
  h: number,
  strength = 6,
): Redaction => ({
  id,
  type: "redaction",
  visible: true,
  locked: false,
  mode,
  rect: { x, y, width: w, height: h },
  strength,
  ...(mode === "solid" ? { color: "#112233" } : {}),
  seed: 1000 + counter++,
});

/** Compares two pictures byte by byte (a plain loop: `toEqual` on large typed arrays is slow). */
function same(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

const full = (source: RgbaImage, layers: Layer[]): RgbaImage => {
  const image = cloneImage(source);
  applyRedactions(image, layers);
  return image;
};

describe("incremental redactions", () => {
  const source = picture(80, 60);

  it("starts as the source and finds nothing to do for an unchanged list", () => {
    const inc = new IncrementalRedactions(source);
    expect(inc.update([])).toBeNull();
    expect(same(inc.image.data, source.data)).toBe(true);
    const layers = [red("a", "blur", 10, 10, 20, 20)];
    expect(inc.update(layers)).not.toBeNull();
    expect(inc.update(layers)).toBeNull();
  });

  it("gives exactly what a full redo gives after every step of a long edit", () => {
    const inc = new IncrementalRedactions(source);
    const a = red("a", "blur", 10, 10, 30, 20);
    const b = red("b", "pixelate", 30, 20, 30, 30, 8);
    const c = red("c", "solid", 5, 40, 20, 10);
    const steps: Layer[][] = [
      [a],
      [a, b],
      [a, b, c],
      [{ ...a, rect: { ...a.rect, x: 14, width: 34 } }, b, c], // a moved and widened, overlapping b
      [b, { ...a, rect: { ...a.rect, x: 14, width: 34 } }, c], // order swapped: overlapping results differ
      [{ ...b, strength: 12 }, c],
      [c],
      [],
      [a, b],
      [a, { ...b, visible: false }],
      [group("g", [a, b]), rect("annotation")],
      [group("g", [a, b], { visible: false })],
    ];
    for (const [i, layers] of steps.entries()) {
      inc.update(layers);
      expect(same(inc.image.data, full(source, layers).data), `step ${String(i)}`).toBe(true);
    }
  });

  it("a random sequence of edits always matches the full redo", () => {
    let seed = 12345;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const inc = new IncrementalRedactions(source);
    let layers: Redaction[] = [];
    const modes = ["blur", "pixelate", "solid"] as const;
    for (let step = 0; step < 60; step += 1) {
      const roll = random();
      if (roll < 0.3 || layers.length === 0) {
        layers = [
          ...layers,
          red(
            `r${String(step)}`,
            modes[Math.floor(random() * 3)] ?? "blur",
            Math.floor(random() * 60) - 5,
            Math.floor(random() * 45) - 5,
            5 + Math.floor(random() * 40),
            5 + Math.floor(random() * 30),
            3 + Math.floor(random() * 10),
          ),
        ];
      } else if (roll < 0.5) {
        layers = layers.filter((_, i) => i !== Math.floor(random() * layers.length));
      } else if (roll < 0.9) {
        const at = Math.floor(random() * layers.length);
        layers = layers.map((l, i) =>
          i === at
            ? {
                ...l,
                rect: {
                  ...l.rect,
                  x: l.rect.x + Math.floor(random() * 9) - 4,
                  y: l.rect.y + Math.floor(random() * 9) - 4,
                },
              }
            : l,
        );
      } else {
        layers = [...layers].reverse();
      }
      inc.update(layers);
      expect(same(inc.image.data, full(source, layers).data), `step ${String(step)}`).toBe(true);
    }
  });

  it("repaints only the part that changed", () => {
    const inc = new IncrementalRedactions(picture(400, 300));
    const a = red("a", "blur", 10, 10, 20, 20);
    const far = red("far", "solid", 300, 200, 50, 50);
    inc.update([a, far]);
    const region = inc.update([{ ...a, rect: { ...a.rect, x: 12 } }, far]);
    expect(region).toEqual({ x: 10, y: 10, width: 22, height: 20 });
  });

  it("copes with a redaction outside the picture", () => {
    const inc = new IncrementalRedactions(source);
    const layers = [red("a", "solid", 500, 500, 10, 10), red("b", "solid", -20, -20, 30, 30)];
    inc.update(layers);
    expect(same(inc.image.data, full(source, layers).data)).toBe(true);
  });
});
