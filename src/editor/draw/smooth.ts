/**
 * Drawing a big picture small without jagged edges.
 *
 * `drawImage` samples a picture with a bilinear filter. That is fine up to half the size and ugly beyond it:
 * a 5K screenshot shown at a third of its size skips most of its pixels, and thin text turns crunchy
 * (and WebKit ignores `imageSmoothingQuality`). So a picture that is drawn at less than half its size is
 * first halved (a 2 x 2 average each time, the "mip chain" of a graphics card) until the last step is
 * smaller than a factor of two, and only that picture is drawn. The chain is kept for as long as the
 * picture does not change.
 */

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type Source = CanvasImageSource;

/** The pixel size of a picture, or 0 x 0 for a kind that is not measured here (a video, an SVG): those are drawn as they are. */
function sizeOf(image: Source): { width: number; height: number } {
  if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) {
    return { width: image.naturalWidth, height: image.naturalHeight };
  }
  const { width, height } = image as { width: unknown; height: unknown };
  return typeof width === "number" && typeof height === "number"
    ? { width, height }
    : { width: 0, height: 0 };
}

/** How many times a picture of `source` pixels is halved to be drawn `device` pixels wide (0: drawn as it is). */
export function halvings(source: number, device: number): number {
  if (!(source > 0) || !(device > 0)) return 0;
  let k = 0;
  while (source / 2 ** (k + 1) >= device) k += 1;
  return k;
}

interface Chain {
  /** What changed the picture last (a counter the owner keeps); a different one drops the chain. */
  revision: number;
  levels: Canvas[];
}

const chains = new WeakMap<object, Chain>();

function makeCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/** Level `k` of the chain: the picture at 1 / 2^k its size (level 0 is the picture itself). */
function level(image: Source, revision: number, k: number): Source {
  if (k === 0) return image;
  let chain = chains.get(image);
  if (chain?.revision !== revision) {
    chain = { revision, levels: [] };
    chains.set(image, chain);
  }
  const { width, height } = sizeOf(image);
  for (let i = chain.levels.length + 1; i <= k; i += 1) {
    const from: Source = i === 1 ? image : (chain.levels[i - 2] ?? image);
    const w = Math.max(1, Math.round(width / 2 ** i));
    const h = Math.max(1, Math.round(height / 2 ** i));
    const next = makeCanvas(w, h);
    const ctx = next.getContext("2d") as
      CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return image;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(from, 0, 0, w, h);
    chain.levels.push(next);
  }
  return chain.levels[k - 1] ?? image;
}

/**
 * Draws `image` into the box `dx, dy, dw, dh` of the current coordinates of `ctx` (any scale, no rotation),
 * halving it first when it ends up smaller than half its size on the screen.
 * `revision` changes whenever the pixels of the picture do (0 for a picture that never changes).
 */
export function drawSmooth(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  image: Source,
  revision: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const t = ctx.getTransform();
  const device = dw * Math.hypot(t.a, t.b);
  const k = halvings(sizeOf(image).width, device);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(level(image, revision, k), dx, dy, dw, dh);
}
