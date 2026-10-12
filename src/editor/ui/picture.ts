import type { Layer, Rect } from "@/document/schema";
import { drawLayers } from "../draw/draw";
import type { BaseImage } from "./base-image";

/**
 * The finished picture as a canvas, for Presentation mode: the baked source (redactions burned in), the
 * annotation layers on top, and the crop taken: the same steps and the same `drawLayers` as the export.
 * The presentation is then drawn around it.
 */
export function renderPicture(
  base: BaseImage,
  layers: readonly Layer[],
  crop: Rect | null,
): OffscreenCanvas {
  base.update(layers);
  const area = crop ?? { x: 0, y: 0, width: base.width, height: base.height };
  const width = Math.max(1, Math.round(area.width));
  const height = Math.max(1, Math.round(area.height));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This system cannot process images in the browser engine.");
  ctx.translate(-Math.round(area.x), -Math.round(area.y));
  ctx.drawImage(base.canvas, 0, 0);
  drawLayers(ctx, layers, { width: base.width, height: base.height });
  return canvas;
}
