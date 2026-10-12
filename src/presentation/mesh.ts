import { seededRandom } from "@/document/render/pixels";
import type { Presentation } from "@/document/schema";
import { parseHex } from "./color";

export type MeshBackground = Extract<Presentation["background"], { type: "mesh" }>;
export type MeshPoint = [number, number];

export const DEFAULT_SMOOTHNESS = 0.7;

/** Columns and rows of the lattice for `count` colours (3 x 3 for nine, 4 x 4 for sixteen). */
export function meshGrid(count: number): { cols: number; rows: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(count)));
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

/**
 * The default positions of the colours: a lattice over the whole canvas whose inner points are nudged
 * by a seeded generator (the edge points stay on the edge). The same seed gives the same layout.
 */
export function defaultMeshPoints(count: number, seed: number): MeshPoint[] {
  const { cols, rows } = meshGrid(count);
  const random = seededRandom(seed);
  const out: MeshPoint[] = [];
  for (let i = 0; i < count; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const jx = (random() * 2 - 1) * (0.35 / Math.max(cols - 1, 1));
    const jy = (random() * 2 - 1) * (0.35 / Math.max(rows - 1, 1));
    const fx = cols === 1 ? 0.5 : col / (cols - 1);
    const fy = rows === 1 ? 0.5 : row / (rows - 1);
    const edgeX = col === 0 || col === cols - 1;
    const edgeY = row === 0 || row === rows - 1;
    out.push([
      Math.min(1, Math.max(0, fx + (edgeX ? 0 : jx))),
      Math.min(1, Math.max(0, fy + (edgeY ? 0 : jy))),
    ]);
  }
  return out;
}

export function meshPoints(background: MeshBackground): MeshPoint[] {
  const count = background.colors.length;
  if (background.points && background.points.length === count) return background.points;
  return defaultMeshPoints(count, background.seed);
}

/**
 * The colour field of a mesh at `width` x `height` samples (RGBA bytes): every sample is the average
 * of the point colours weighted by `1 / (d² + 0.004)^q`, where `d` is the distance in canvas units
 * (0 to 1 on each axis) and `q = 1 + 3 x (1 - smoothness)`. The canvas draws it scaled up smoothly.
 */
export function renderMeshField(
  background: MeshBackground,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const points = meshPoints(background);
  const colors = background.colors.map(parseHex);
  const q = 1 + 3 * (1 - (background.smoothness ?? DEFAULT_SMOOTHNESS));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const py = (y + 0.5) / height;
    for (let x = 0; x < width; x += 1) {
      const px = (x + 0.5) / width;
      let total = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = 0; i < points.length; i += 1) {
        const [mx, my] = points[i] ?? [0, 0];
        const d2 = (px - mx) ** 2 + (py - my) ** 2;
        const w = 1 / (d2 + 0.004) ** q;
        const c = colors[i] ?? [0, 0, 0, 1];
        total += w;
        r += w * c[0];
        g += w * c[1];
        b += w * c[2];
      }
      const at = (y * width + x) * 4;
      out[at] = r / total;
      out[at + 1] = g / total;
      out[at + 2] = b / total;
      out[at + 3] = 255;
    }
  }
  return out;
}

/** The size of the field for a canvas: an eighth of it, at least 8 and at most 256 samples a side. */
export function meshFieldSize(canvasWidth: number, canvasHeight: number) {
  const f = Math.max(canvasWidth, canvasHeight) / 8;
  const k = f > 256 ? 256 / f : 1;
  const scale = (v: number) => Math.min(256, Math.max(8, Math.round((v / 8) * k)));
  return { width: scale(canvasWidth), height: scale(canvasHeight) };
}
