import { walkLayers } from "@/document/layers";
import type { Project } from "@/document/schema";
import { computeLayout } from "@/presentation/compose";

/** The numbers and words of the Export dialog, as pure functions (tested in Node). */

export type ImageFormat = "png" | "jpg" | "webp";
export type ExportFormat = ImageFormat | "lumengrab";

export interface Size {
  width: number;
  height: number;
}

/** The picture of the crop, or the whole source: what the presentation is put around. */
export function pictureSize(project: Project, source: Size): Size {
  return project.crop
    ? { width: Math.round(project.crop.width), height: Math.round(project.crop.height) }
    : { width: source.width, height: source.height };
}

/** The picture that gets exported: the crop, or the whole source, or the finished presentation around it. */
export function contentSize(project: Project, source: Size): Size {
  const picture = pictureSize(project, source);
  if (!project.presentation.enabled) return picture;
  return computeLayout(picture, project.presentation).output;
}

/** The size at a scale factor (0.5×, 1×, 2×), at least one pixel each way. */
export function sizeForScale(content: Size, scale: number): Size {
  return {
    width: Math.max(1, Math.round(content.width * scale)),
    height: Math.max(1, Math.round(content.height * scale)),
  };
}

export const MAX_EXPORT_EDGE = 16384;

/**
 * A custom size: one side is typed. With the lock the other follows (the ratio of the picture), without it
 * stays. Sides are kept between 1 pixel and the 16k limit of the format (the other side shrinks with it
 * when locked).
 */
export function customSize(
  content: Size,
  current: Size,
  side: "width" | "height",
  value: number,
  locked: boolean,
): Size {
  let width = side === "width" ? value : current.width;
  let height = side === "height" ? value : current.height;
  const ratio = content.width / content.height;
  if (locked) {
    if (side === "width") height = width / ratio;
    else width = height * ratio;
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  const shrink = Math.min(1, MAX_EXPORT_EDGE / width, MAX_EXPORT_EDGE / height);
  return locked && shrink < 1
    ? { width: Math.round(width * shrink), height: Math.round(height * shrink) }
    : { width: Math.min(width, MAX_EXPORT_EDGE), height: Math.min(height, MAX_EXPORT_EDGE) };
}

/** Which scale chip matches a size, or `custom`. */
export function scaleOf(content: Size, size: Size): 0.5 | 1 | 2 | "custom" {
  for (const scale of [0.5, 1, 2] as const) {
    const s = sizeForScale(content, scale);
    if (s.width === size.width && s.height === size.height) return scale;
  }
  return "custom";
}

export const EXTENSION: Record<ExportFormat, string> = {
  png: "png",
  jpg: "jpg",
  webp: "webp",
  lumengrab: "lumengrab",
};

/** "Screenshot 2026-10-09 at 14.02.lumengrab" -> "Screenshot 2026-10-09 at 14.02". */
export function baseName(fileName: string): string {
  return fileName.replace(/\.(lumengrab|png|jpe?g|webp)$/i, "");
}

export function fileNameFor(base: string, format: ExportFormat): string {
  return `${baseName(base) || "Screenshot"}.${EXTENSION[format]}`;
}

/** The mime type a canvas encodes. */
export const MIME: Record<ImageFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/** Visible redactions (those a flat export burns into the picture). */
export function countRedactions(project: Project): number {
  let n = 0;
  walkLayers(project.layers, (layer, info) => {
    if (layer.type === "redaction" && !info.hidden) n += 1;
  });
  return n;
}

/** "2 redactions are burned into the image. The pixels underneath are gone." (the note of the dialog) */
export function redactionNote(count: number): string {
  return count === 1
    ? "1 redaction is burned into the image. The pixels underneath are gone."
    : `${String(count)} redactions are burned into the image. The pixels underneath are gone.`;
}

/** "3 annotations" / "1 redaction" / "no changes yet", for the recovery list. */
export function describeEdits(project: Project): string {
  let annotations = 0;
  let redactions = 0;
  walkLayers(project.layers, (layer) => {
    if (layer.type === "redaction") redactions += 1;
    else if (layer.type !== "group") annotations += 1;
  });
  const parts: string[] = [];
  if (annotations > 0)
    parts.push(`${String(annotations)} ${annotations === 1 ? "annotation" : "annotations"}`);
  if (redactions > 0)
    parts.push(`${String(redactions)} ${redactions === 1 ? "redaction" : "redactions"}`);
  if (project.crop) parts.push("cropped");
  return parts.length > 0 ? parts.join(", ") : "no changes yet";
}

/** "about 380 KB" */
export function approxSize(bytes: number): string {
  if (bytes < 1024) return `about ${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `about ${String(Math.round(bytes / 1024))} KB`;
  return `about ${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "Edited today, 14:32" / "Edited yesterday, 22:48" / "Edited 3 Oct, 09:10" */
export function editedLabel(ms: number, now: Date = new Date()): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Edited today, ${time}`;
  if (days === 1) return `Edited yesterday, ${time}`;
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `Edited ${day}, ${time}`;
}
