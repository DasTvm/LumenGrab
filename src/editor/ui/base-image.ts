import type { Layer } from "@/document/schema";
import type { RgbaImage } from "@/document/render/pixels";
import { IncrementalRedactions } from "./incremental-redactions";

type Canvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(width: number, height: number): Canvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * The picture the editor draws annotations on: the source with every visible redaction **baked into
 * its pixels** by the same functions the export uses (`document/render/pixels.ts`), so what a redaction
 * looks like in the editor is exactly what leaves the app. It is kept up to date incrementally: moving
 * or resizing a redaction redoes only the rectangles it touched (`IncrementalRedactions`), not the whole
 * picture, and annotations or the view never touch it.
 */
export class BaseImage {
  readonly canvas: Canvas;
  readonly width: number;
  readonly height: number;
  private readonly redactions: IncrementalRedactions;
  /** Shares its pixels with `redactions.image`, so a repaint copies nothing. */
  private readonly pixels: ImageData;

  constructor(source: RgbaImage) {
    this.width = source.width;
    this.height = source.height;
    this.canvas = makeCanvas(source.width, source.height);
    this.redactions = new IncrementalRedactions(source);
    // Our own array, made from a plain ArrayBuffer (never shared memory).
    this.pixels = new ImageData(
      this.redactions.image.data as Uint8ClampedArray<ArrayBuffer>,
      source.width,
      source.height,
    );
    this.paint(null);
  }

  private paint(region: { x: number; y: number; width: number; height: number } | null): void {
    const ctx =
      this.canvas instanceof HTMLCanvasElement
        ? this.canvas.getContext("2d")
        : this.canvas.getContext("2d");
    if (!ctx) throw new Error("This system cannot process images in the browser engine.");
    if (region)
      ctx.putImageData(this.pixels, 0, 0, region.x, region.y, region.width, region.height);
    else ctx.putImageData(this.pixels, 0, 0);
  }

  /** Applies the redactions of `layers`. Returns whether the picture changed. */
  update(layers: readonly Layer[]): boolean {
    const region = this.redactions.update(layers);
    if (!region) return false;
    this.paint(region);
    return true;
  }
}
