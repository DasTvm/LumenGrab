import { flattenProject, PREVIEW_MAX_EDGE } from "@/document/render/flatten";
import { downscaleImage, type RgbaImage } from "@/document/render/pixels";
import type { Project } from "@/document/schema";
import { platform } from "@/platform";
import { editorCodec } from "./draw/codec";
import { MIME, type ImageFormat, type Size } from "./export-model";

/**
 * Rendering the picture for export: redactions burned in, annotations drawn, crop taken (the same
 * `flattenProject` as the preview), then an optional resize and the encoder of the chosen format. Needs
 * a browser engine (canvas); the numbers it uses are in `export-model.ts`.
 */

function makeCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(width, height);
}

function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This system cannot process images in the browser engine.");
  return ctx;
}

/** The picture of a document as it is exported (before resizing). */
export function flatten(source: RgbaImage, project: Project): Promise<RgbaImage> {
  return flattenProject(source, project, editorCodec);
}

/** Smooth resampling to `size` (the Export dialog's 0.5×, 2× or a custom size). */
export function resizeImage(image: RgbaImage, size: Size): RgbaImage {
  if (size.width === image.width && size.height === image.height) return image;
  const from = makeCanvas(image.width, image.height);
  context(from).putImageData(
    new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
    0,
    0,
  );
  const to = makeCanvas(size.width, size.height);
  const ctx = context(to);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(from, 0, 0, size.width, size.height);
  const { data } = ctx.getImageData(0, 0, size.width, size.height);
  return { width: size.width, height: size.height, data };
}

/**
 * Encodes with the browser's own encoder. JPEG has no transparency: it is laid on white first.
 * `quality` is 0..1 and only matters for JPEG and WebP.
 */
export async function encodeImage(
  image: RgbaImage,
  format: ImageFormat,
  quality = 0.9,
): Promise<Uint8Array> {
  const canvas = makeCanvas(image.width, image.height);
  const ctx = context(canvas);
  if (format === "jpg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, image.width, image.height);
    const layer = makeCanvas(image.width, image.height);
    context(layer).putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
    ctx.drawImage(layer, 0, 0);
  } else {
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(image.data), image.width, image.height),
      0,
      0,
    );
  }
  if (format === "webp" && !(await canvasEncodesWebp())) {
    // WebKit's canvas cannot encode WebP: the native side does (libwebp).
    return platform.encodeWebp(image.data, image.width, image.height, Math.round(quality * 100));
  }
  const blob = await canvas.convertToBlob({
    type: MIME[format],
    ...(format === "png" ? {} : { quality }),
  });
  if (blob.type !== MIME[format]) {
    // A browser engine that cannot encode this format hands back a PNG instead: never save that under another name.
    throw new Error(`This system cannot save ${format.toUpperCase()} images.`);
  }
  return new Uint8Array(await blob.arrayBuffer());
}

let canvasWebp: Promise<boolean> | null = null;

/** Whether the WebView's own canvas can encode WebP (Chromium can, the WebView of macOS cannot). */
function canvasEncodesWebp(): Promise<boolean> {
  canvasWebp ??= (async () => {
    try {
      const probe = new OffscreenCanvas(1, 1);
      context(probe).fillRect(0, 0, 1, 1);
      return (
        (await probe.convertToBlob({ type: "image/webp", quality: 0.8 })).type === "image/webp"
      );
    } catch {
      return false;
    }
  })();
  return canvasWebp;
}

let webp: Promise<boolean> | null = null;

/** Whether the engine can encode WebP (WebKit could not for a long time): the dialog hides the choice if not. */
export function webpEncodingAvailable(): Promise<boolean> {
  webp ??= (async () => {
    try {
      const bytes = await encodeImage(
        { width: 1, height: 1, data: new Uint8ClampedArray([0, 0, 0, 255]) },
        "webp",
        0.8,
      );
      return bytes.length > 0;
    } catch {
      return false;
    }
  })();
  return webp;
}

export interface ExportRequest {
  format: ImageFormat;
  size: Size;
  /** 0..1 (JPEG, WebP). */
  quality: number;
}

/** The finished file of an export. */
export async function renderExport(
  source: RgbaImage,
  project: Project,
  request: ExportRequest,
): Promise<Uint8Array> {
  const flat = await flatten(source, project);
  return encodeImage(resizeImage(flat, request.size), request.format, request.quality);
}

/** The flat PNG for the clipboard. */
export async function renderPng(source: RgbaImage, project: Project): Promise<Uint8Array> {
  return encodeImage(await flatten(source, project), "png");
}

/** `preview.png` for a saved file: the flat picture, longest edge at most 1024 px (docs/FORMAT.md section 2). */
export async function renderPreviewPng(source: RgbaImage, project: Project): Promise<Uint8Array> {
  return encodeImage(downscaleImage(await flatten(source, project), PREVIEW_MAX_EDGE), "png");
}
