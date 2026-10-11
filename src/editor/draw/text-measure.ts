import type { Layer } from "@/document/schema";
import type { MeasureText } from "../model/geometry";
import type { Ctx2D } from "./draw";
import { layoutTextLayer } from "./draw";

let shared: Ctx2D | null = null;

function context(): Ctx2D {
  if (shared) return shared;
  const canvas =
    typeof OffscreenCanvas !== "undefined"
      ? new OffscreenCanvas(8, 8)
      : document.createElement("canvas");
  const ctx =
    canvas instanceof HTMLCanvasElement ? canvas.getContext("2d") : canvas.getContext("2d");
  if (!ctx) throw new Error("This system cannot process images in the browser engine.");
  shared = ctx;
  return ctx;
}

/**
 * The size of a text layer's block as it is drawn (docs/FORMAT.md "Rendering rules"): the editor's
 * hit tests, handles and the text field use it, so they agree with the drawing and the export.
 * The fonts must be loaded (`ensureFonts`), or the numbers are those of the fallback font.
 */
export const measureTextLayer: MeasureText = (layer: Layer) => {
  const layout = layoutTextLayer(context(), layer);
  return { width: layout.width, height: layout.height };
};
