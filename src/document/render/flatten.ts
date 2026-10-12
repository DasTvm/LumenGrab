import { walkLayers } from "../layers";
import type { Layer, Presentation, Project } from "../schema";
import type { DocumentFile } from "../types";
import { applyRedactions, cloneImage, cropImage, downscaleImage, type RgbaImage } from "./pixels";

/**
 * Decodes and encodes PNGs, and draws annotations. The WebView uses `canvas-codec.ts` (and the editor's
 * `editorCodec`, which adds `annotate`); tests use a small Node implementation that cannot draw.
 */
export interface ImageCodec {
  decode(png: Uint8Array): Promise<RgbaImage>;
  encode(image: RgbaImage): Promise<Uint8Array>;
  /**
   * Draws the annotation layers over the picture (redactions are already baked into its pixels by
   * then) and returns the result. Missing: this codec cannot render a document with annotations.
   */
  annotate?(image: RgbaImage, layers: readonly Layer[]): Promise<RgbaImage>;
  /**
   * Puts the finished picture on its background with padding, shadow and frame (docs/FORMAT.md section
   * 4b) and returns the result at output size. `assets` holds the files of the document for an image background.
   */
  present?(
    image: RgbaImage,
    presentation: Presentation,
    assets: Readonly<Record<string, Uint8Array>>,
  ): Promise<RgbaImage>;
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

/** True if the project has an annotation layer (hidden ones included). */
export function hasAnnotations(project: Project): boolean {
  let found = false;
  walkLayers(project.layers, (layer: Layer) => {
    if (ANNOTATION_TYPES.includes(layer.type)) found = true;
  });
  return found;
}

/** True if something has to be drawn: a visible annotation (not hidden itself or by a group). */
export function hasVisibleAnnotations(project: Project): boolean {
  let found = false;
  walkLayers(project.layers, (layer: Layer, info) => {
    if (!info.hidden && ANNOTATION_TYPES.includes(layer.type)) found = true;
  });
  return found;
}

/**
 * The flat picture of a project **without annotations**: visible redactions baked into the **full**
 * source image first, then the crop is taken, so a redaction cannot be cropped or ordered away. The
 * source image is not modified.
 */
export function flattenImage(source: RgbaImage, project: Project): RgbaImage {
  const working = cloneImage(source);
  applyRedactions(working, project.layers);
  return cropImage(working, project.crop);
}

/**
 * The flat picture with everything: redactions destroy their pixels first, then the annotations are
 * drawn over the result in z-order, then the crop is taken (docs/FORMAT.md "Rendering rules"). A
 * document with visible annotations needs a codec that can draw; there is no silent fallback that
 * would export it without them.
 */
export async function flattenProject(
  source: RgbaImage,
  project: Project,
  codec: ImageCodec,
): Promise<RgbaImage> {
  const working = cloneImage(source);
  applyRedactions(working, project.layers);
  let drawn = working;
  if (hasVisibleAnnotations(project)) {
    if (!codec.annotate) throw new Error("This renderer cannot draw annotations.");
    drawn = await codec.annotate(working, project.layers);
  }
  return cropImage(drawn, project.crop);
}

/**
 * What leaves the app: `flattenProject`, and when the presentation is on, laid on its background
 * (padding, shadow, frame, aspect). The order is redactions, annotations, crop, presentation.
 */
export async function presentProject(
  source: RgbaImage,
  project: Project,
  codec: ImageCodec,
  assets: Readonly<Record<string, Uint8Array>> = {},
): Promise<RgbaImage> {
  const flat = await flattenProject(source, project, codec);
  if (!project.presentation.enabled) return flat;
  if (!codec.present) throw new Error("This renderer cannot draw a presentation.");
  return codec.present(flat, project.presentation, assets);
}

/** Renders a document at full resolution as PNG bytes (for "Export as PNG"). */
export async function renderFlat(doc: DocumentFile, codec: ImageCodec): Promise<Uint8Array> {
  if (!doc.project) throw new Error("This document is open read-only and cannot be rendered.");
  const source = await codec.decode(doc.source);
  return codec.encode(await presentProject(source, doc.project, codec, doc.assets));
}

/** Renders `preview.png`: the finished picture (with its presentation), longest edge at most 1024 px. */
export async function renderPreview(doc: DocumentFile, codec: ImageCodec): Promise<Uint8Array> {
  if (!doc.project) throw new Error("This document is open read-only and cannot be rendered.");
  const source = await codec.decode(doc.source);
  return codec.encode(
    downscaleImage(await presentProject(source, doc.project, codec, doc.assets), PREVIEW_MAX_EDGE),
  );
}
