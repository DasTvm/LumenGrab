import { walkLayers } from "../layers";
import type { Layer, Project } from "../schema";
import type { DocumentFile } from "../types";
import { applyRedactions, cloneImage, cropImage, downscaleImage, type RgbaImage } from "./pixels";

/** Decodes and encodes PNGs. The WebView uses `canvas-codec.ts`; tests use a small Node implementation. */
export interface ImageCodec {
  decode(png: Uint8Array): Promise<RgbaImage>;
  encode(image: RgbaImage): Promise<Uint8Array>;
}

/** Longest edge of `preview.png` (docs/FORMAT.md section 2). */
export const PREVIEW_MAX_EDGE = 1024;

/** Layers that are drawn on top of the picture (everything except redactions, which are baked into the pixels). */
const ANNOTATION_TYPES = [
  "arrow",
  "line",
  "rect",
  "ellipse",
  "text",
  "counter",
  "pencil",
  "highlighter",
  "spotlight",
];

/** True if the project has a visible layer that is drawn over the picture. Those are not rendered yet (the editor, M4, draws them). */
export function hasAnnotations(project: Project): boolean {
  let found = false;
  walkLayers(project.layers, (layer: Layer) => {
    if (ANNOTATION_TYPES.includes(layer.type)) found = true;
  });
  return found;
}

/**
 * The flat picture of a project: visible redactions baked into the **full** source image first, then
 * the crop is taken, so a redaction cannot be cropped or ordered away. Annotations are not drawn yet.
 * The source image is not modified.
 */
export function flattenImage(source: RgbaImage, project: Project): RgbaImage {
  const working = cloneImage(source);
  applyRedactions(working, project.layers);
  return cropImage(working, project.crop);
}

/** Renders a document at full resolution as PNG bytes (for "Export as PNG"). */
export async function renderFlat(doc: DocumentFile, codec: ImageCodec): Promise<Uint8Array> {
  if (!doc.project) throw new Error("This document is open read-only and cannot be rendered.");
  const source = await codec.decode(doc.source);
  return codec.encode(flattenImage(source, doc.project));
}

/** Renders `preview.png`: the flat picture, longest edge at most 1024 px. */
export async function renderPreview(doc: DocumentFile, codec: ImageCodec): Promise<Uint8Array> {
  if (!doc.project) throw new Error("This document is open read-only and cannot be rendered.");
  const source = await codec.decode(doc.source);
  return codec.encode(downscaleImage(flattenImage(source, doc.project), PREVIEW_MAX_EDGE));
}
