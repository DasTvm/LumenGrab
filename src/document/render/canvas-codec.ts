import type { RgbaImage } from "./pixels";
import type { ImageCodec } from "./flatten";

/**
 * PNG decode/encode through the browser's own image pipeline (the WebView in the app, any browser in
 * the mock). No colour conversion and no premultiplication on the way in, so pixels survive exactly.
 */
type Canvas2d = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(width: number, height: number): Canvas2d {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function context(canvas: Canvas2d): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error("This system cannot process images in the browser engine.");
  return ctx;
}

async function toPng(canvas: Canvas2d): Promise<Uint8Array> {
  if ("convertToBlob" in canvas) {
    return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
  }
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/png");
  });
  if (!blob) throw new Error("The image could not be encoded.");
  return new Uint8Array(await blob.arrayBuffer());
}

export const canvasCodec: ImageCodec = {
  async decode(png) {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(png)], { type: "image/png" }), {
      premultiplyAlpha: "none",
      colorSpaceConversion: "none",
    });
    try {
      const canvas = makeCanvas(bitmap.width, bitmap.height);
      const ctx = context(canvas);
      ctx.drawImage(bitmap, 0, 0);
      const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      return { width: bitmap.width, height: bitmap.height, data };
    } finally {
      bitmap.close();
    }
  },

  async encode(image: RgbaImage) {
    const canvas = makeCanvas(image.width, image.height);
    const ctx = context(canvas);
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
    return toPng(canvas);
  },
};
