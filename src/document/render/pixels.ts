import type { Layer, Rect, Redaction } from "../schema";

/**
 * Pixel work on plain RGBA arrays (no canvas, no DOM), so it runs and is tested in Node and in the
 * WebView alike. Redactions here **destroy** the pixels: a flat export or preview built from this
 * never contains what was under a visible redaction (docs/FORMAT.md section 7).
 */

export interface RgbaImage {
  width: number;
  height: number;
  /** `width * height * 4` bytes, straight (not premultiplied) alpha, row 0 on top. */
  data: Uint8ClampedArray;
}

/** A pixel rectangle fully inside an image. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Blur radius below this is raised to it: a "blur" that changes nothing would be a silent leak. */
export const MIN_BLUR_RADIUS = 6;
export const MAX_BLUR_RADIUS = 200;
/** Pixelate blocks smaller than this are raised to it. */
export const MIN_PIXEL_BLOCK = 4;
/** How far the seeded noise may move a block's colour, per channel. */
const PIXELATE_NOISE = 6;
/** Share of a block's colour that comes from one randomly chosen pixel of the block instead of the average. */
const PIXELATE_SAMPLE_SHARE = 0.3;

export function cloneImage(image: RgbaImage): RgbaImage {
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
}

/** The part of `rect` that lies inside a `width` x `height` image, on whole pixels; `null` if nothing is left. */
export function clampRect(rect: Rect, width: number, height: number): PixelRect | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The cropped image, or the whole image if the crop leaves nothing. */
export function cropImage(image: RgbaImage, crop: Rect | null): RgbaImage {
  const box = crop ? clampRect(crop, image.width, image.height) : null;
  if (!box) return image;
  const out = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    const from = ((box.y + y) * image.width + box.x) * 4;
    out.set(image.data.subarray(from, from + box.width * 4), y * box.width * 4);
  }
  return { width: box.width, height: box.height, data: out };
}

/**
 * Scales an image down so its longest edge is at most `maxEdge`, keeping the aspect ratio, by
 * averaging each block of source pixels. A smaller image is returned unchanged.
 */
export function downscaleImage(image: RgbaImage, maxEdge: number): RgbaImage {
  const longest = Math.max(image.width, image.height);
  if (longest <= maxEdge || maxEdge < 1) return image;
  const factor = maxEdge / longest;
  const width = Math.max(1, Math.round(image.width * factor));
  const height = Math.max(1, Math.round(image.height * factor));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let dy = 0; dy < height; dy += 1) {
    const y0 = Math.floor((dy * image.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((dy + 1) * image.height) / height));
    for (let dx = 0; dx < width; dx += 1) {
      const x0 = Math.floor((dx * image.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((dx + 1) * image.width) / width));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const at = (y * image.width + x) * 4;
          r += image.data[at] ?? 0;
          g += image.data[at + 1] ?? 0;
          b += image.data[at + 2] ?? 0;
          a += image.data[at + 3] ?? 0;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      out.set([r / n, g / n, b / n, a / n], (dy * width + dx) * 4);
    }
  }
  return { width, height, data: out };
}

/** A small, fast, seedable random generator (mulberry32). The same seed always gives the same numbers. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function parseColor(hex: string | undefined): [number, number, number] {
  const match = hex ? /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})/.exec(hex) : null;
  if (!match) return [0, 0, 0];
  return [
    parseInt(match[1] ?? "0", 16),
    parseInt(match[2] ?? "0", 16),
    parseInt(match[3] ?? "0", 16),
  ];
}

/** Opaque fill. The alpha of the colour is ignored on purpose: a see-through "solid" would not destroy anything. */
function applySolid(image: RgbaImage, box: PixelRect, color: string | undefined): void {
  const [r, g, b] = parseColor(color);
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      image.data.set([r, g, b, 255], (y * image.width + x) * 4);
    }
  }
}

/**
 * One box-blur pass along one axis over a `length` x `lines` block, edges clamped to the block (so
 * nothing outside the redaction ever flows in). `stride` steps along the axis, `lineStride` between lines.
 */
function boxBlurAxis(
  data: Float32Array,
  length: number,
  lines: number,
  stride: number,
  lineStride: number,
  radius: number,
): void {
  const window = radius * 2 + 1;
  const line = new Float32Array(length * 4);
  for (let l = 0; l < lines; l += 1) {
    const base = l * lineStride;
    for (let channel = 0; channel < 4; channel += 1) {
      for (let i = 0; i < length; i += 1)
        line[i * 4 + channel] = data[base + i * stride + channel] ?? 0;
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) {
        sum += line[Math.min(length - 1, Math.max(0, k)) * 4 + channel] ?? 0;
      }
      for (let i = 0; i < length; i += 1) {
        data[base + i * stride + channel] = sum / window;
        const leaving = Math.max(0, i - radius);
        const entering = Math.min(length - 1, i + radius + 1);
        sum += (line[entering * 4 + channel] ?? 0) - (line[leaving * 4 + channel] ?? 0);
      }
    }
  }
}

function applyBlur(image: RgbaImage, box: PixelRect, strength: number): void {
  const radius = Math.min(MAX_BLUR_RADIUS, Math.max(MIN_BLUR_RADIUS, Math.round(strength)));
  const region = new Float32Array(box.width * box.height * 4);
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const from = ((box.y + y) * image.width + box.x + x) * 4;
      for (let c = 0; c < 4; c += 1)
        region[(y * box.width + x) * 4 + c] = image.data[from + c] ?? 0;
    }
  }
  // Three passes of a box blur in each direction approximate a gaussian blur.
  for (let pass = 0; pass < 3; pass += 1) {
    boxBlurAxis(region, box.width, box.height, 4, box.width * 4, radius);
    boxBlurAxis(region, box.height, box.width, box.width * 4, 4, radius);
  }
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const to = ((box.y + y) * image.width + box.x + x) * 4;
      for (let c = 0; c < 4; c += 1) image.data[to + c] = region[(y * box.width + x) * 4 + c] ?? 0;
    }
  }
}

/**
 * Blocks of the average colour, nudged by seeded noise and a randomly chosen pixel of each block, so
 * the result is not a clean function of the source (it cannot be undone by guessing the average) and
 * is still identical for the same `seed`.
 */
function applyPixelate(image: RgbaImage, box: PixelRect, strength: number, seed: number): void {
  const block = Math.max(MIN_PIXEL_BLOCK, Math.round(strength));
  const random = seededRandom(seed);
  for (let by = box.y; by < box.y + box.height; by += block) {
    for (let bx = box.x; bx < box.x + box.width; bx += block) {
      const bw = Math.min(block, box.x + box.width - bx);
      const bh = Math.min(block, box.y + box.height - by);
      const sum = [0, 0, 0, 0];
      for (let y = by; y < by + bh; y += 1) {
        for (let x = bx; x < bx + bw; x += 1) {
          const at = (y * image.width + x) * 4;
          for (let c = 0; c < 4; c += 1) sum[c] = (sum[c] ?? 0) + (image.data[at + c] ?? 0);
        }
      }
      const pickX = bx + Math.floor(random() * bw);
      const pickY = by + Math.floor(random() * bh);
      const pick = (pickY * image.width + pickX) * 4;
      const color = [0, 1, 2, 3].map((c) => {
        const average = (sum[c] ?? 0) / (bw * bh);
        const sampled = image.data[pick + c] ?? average;
        const mixed = average * (1 - PIXELATE_SAMPLE_SHARE) + sampled * PIXELATE_SAMPLE_SHARE;
        return c === 3 ? mixed : mixed + (random() * 2 - 1) * PIXELATE_NOISE;
      });
      for (let y = by; y < by + bh; y += 1) {
        for (let x = bx; x < bx + bw; x += 1) image.data.set(color, (y * image.width + x) * 4);
      }
    }
  }
}

/** Applies one redaction in place. A redaction outside the image does nothing. */
export function applyRedaction(image: RgbaImage, layer: Redaction): void {
  const box = clampRect(layer.rect, image.width, image.height);
  if (!box) return;
  if (layer.mode === "solid") applySolid(image, box, layer.color);
  else if (layer.mode === "blur") applyBlur(image, box, layer.strength);
  else applyPixelate(image, box, layer.strength, layer.seed);
}

/** The layers that are visible redactions, bottom to top. Hidden layers are not rendered, redactions included. */
export function visibleRedactions(layers: readonly Layer[]): Redaction[] {
  return layers.filter((l): l is Redaction => l.type === "redaction" && l.visible === true);
}

/** Applies all visible redactions in place, bottom to top. */
export function applyRedactions(image: RgbaImage, layers: readonly Layer[]): void {
  for (const layer of visibleRedactions(layers)) applyRedaction(image, layer);
}
