import type { Layer } from "@/document/schema";
import {
  applyRedactions,
  cloneImage,
  visibleRedactions,
  type RgbaImage,
} from "@/document/render/pixels";

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
 * looks like in the editor is exactly what leaves the app. It is rebuilt only when a redaction changes
 * (its rectangle, mode, strength, colour, visibility), not when annotations or the view change.
 */
export class BaseImage {
  readonly canvas: Canvas;
  readonly width: number;
  readonly height: number;
  private signature = "";

  constructor(private readonly source: RgbaImage) {
    this.width = source.width;
    this.height = source.height;
    this.canvas = makeCanvas(source.width, source.height);
    this.paint(source);
  }

  private paint(image: RgbaImage): void {
    const ctx =
      this.canvas instanceof HTMLCanvasElement
        ? this.canvas.getContext("2d")
        : this.canvas.getContext("2d");
    if (!ctx) throw new Error("This system cannot process images in the browser engine.");
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
  }

  /** Applies the redactions of `layers`. Returns whether the picture changed. */
  update(layers: readonly Layer[]): boolean {
    const redactions = visibleRedactions(layers);
    const signature = JSON.stringify(
      redactions.map((r) => [r.mode, r.rect, r.strength, r.color, r.seed]),
    );
    if (signature === this.signature) return false;
    this.signature = signature;
    if (redactions.length === 0) {
      this.paint(this.source);
    } else {
      const working = cloneImage(this.source);
      applyRedactions(working, layers);
      this.paint(working);
    }
    return true;
  }
}
