import { canvasCodec } from "@/document/render/canvas-codec";
import type { ImageCodec } from "@/document/render/flatten";
import { drawLayers } from "./draw";
import { ensureFonts } from "./fonts";

/**
 * The WebView's codec plus annotation drawing: what the app uses for the preview inside a saved file,
 * the export, the clipboard. The drawing code is the same `drawLayers` the editor shows.
 */
export const editorCodec: ImageCodec = {
  ...canvasCodec,
  async annotate(image, layers) {
    await ensureFonts(layers);
    const canvas = new OffscreenCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("This system cannot process images in the browser engine.");
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
    drawLayers(ctx, layers, { width: image.width, height: image.height });
    const { data } = ctx.getImageData(0, 0, image.width, image.height);
    return { width: image.width, height: image.height, data };
  },
};
