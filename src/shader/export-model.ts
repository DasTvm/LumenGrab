import { posterSeconds } from "./scene";
import type { ShaderScene } from "./types";

/**
 * What the export dialog offers and what it makes of it: sizes, frame counts, the limits and the size a file
 * will probably have. Plain numbers, tested in Node.
 */
export type ExportKind = "video" | "gif" | "picture";
export type SizePreset = "720p" | "1080p" | "4k" | "canvas";
export type VideoFormat = "mp4" | "webm";
export type PictureFormat = "png" | "jpg" | "webp";
export type Quality = "high" | "medium" | "low";
export type Content = "composition" | "background";

export const FRAME_RATES = [24, 30, 60] as const;
export const REPEATS = [1, 2, 3, 4, 5] as const;
export const GIF_COLOURS = [64, 128, 256] as const;

const BOX: Record<Exclude<SizePreset, "canvas">, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
  "4k": { width: 3840, height: 2160 },
};

/** The biggest side of anything that is made (a frame of a video is never bigger than the graphics card can draw). */
export const MAX_SIDE = 4096;
/** Pixels times frames a video may have in all: 4K at 60 frames a second for 30 seconds. */
export const VIDEO_BUDGET = 3840 * 2160 * 60 * 30;
/** The longest video, in seconds, whatever the size. */
export const MAX_SECONDS = 120;
/** A GIF is bigger and slower to make: fewer frames and pixels. */
export const GIF_MAX_FRAMES = 600;
export const GIF_MAX_PIXELS = 1920 * 1080;

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** The size of a picture that has the shape of `canvas` and fits the preset's box (never bigger than the canvas needs for "canvas"). */
export function fitSize(
  canvas: { width: number; height: number },
  preset: SizePreset,
  options: { even?: boolean } = {},
): { width: number; height: number } {
  let width = canvas.width;
  let height = canvas.height;
  if (preset !== "canvas") {
    const box = BOX[preset];
    const k = Math.min(box.width / canvas.width, box.height / canvas.height);
    width = canvas.width * k;
    height = canvas.height * k;
  }
  const k = Math.min(1, MAX_SIDE / Math.max(width, height));
  width *= k;
  height *= k;
  return options.even
    ? { width: even(width), height: even(height) }
    : { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

export interface MotionPlan {
  fps: number;
  /** Frames that will be made (after any shortening). */
  frames: number;
  /** Frames the whole export would have. */
  wanted: number;
  /** Seconds of the result. */
  seconds: number;
  /** The export was made shorter than asked because of the limits. */
  shortened: boolean;
}

/** How many frames a loop repeated `repeats` times has at `fps`, and how many the limits allow. */
export function planMotion(
  scene: Pick<ShaderScene, "loop">,
  size: { width: number; height: number },
  fps: number,
  repeats: number,
  kind: "video" | "gif",
): MotionPlan {
  const wanted = Math.max(1, Math.round(scene.loop * repeats * fps));
  const pixels = size.width * size.height;
  const byBudget =
    kind === "gif"
      ? Math.min(
          GIF_MAX_FRAMES,
          Math.floor((GIF_MAX_PIXELS * GIF_MAX_FRAMES) / Math.max(pixels, 1)),
        )
      : Math.floor(VIDEO_BUDGET / Math.max(pixels, 1));
  const allowed = Math.max(1, Math.min(byBudget, MAX_SECONDS * fps));
  const frames = Math.min(wanted, allowed);
  return { fps, frames, wanted, seconds: frames / fps, shortened: frames < wanted };
}

/** The moment of frame `index` in seconds (frame `index` of a loop of `scene.loop` seconds). */
export const frameTime = (index: number, fps: number): number => index / fps;

/** A rule of thumb for soft, moving backgrounds; the dialog measures the real size and uses this only until then. */
const BITS_PER_PIXEL: Record<Quality, number> = { high: 0.08, medium: 0.04, low: 0.02 };

/** About how many bytes a video of the plan will be (the size field of the dialog). */
export function estimateVideoBytes(
  size: { width: number; height: number },
  plan: MotionPlan,
  quality: Quality,
): number {
  return (size.width * size.height * plan.fps * BITS_PER_PIXEL[quality] * plan.seconds) / 8;
}

const GIF_BYTES_PER_PIXEL: Record<number, number> = { 64: 0.14, 128: 0.18, 256: 0.225 };

export function estimateGifBytes(
  size: { width: number; height: number },
  plan: MotionPlan,
  colours: number,
): number {
  return size.width * size.height * (GIF_BYTES_PER_PIXEL[colours] ?? 0.225) * plan.frames;
}

const PICTURE_BYTES_PER_PIXEL: Record<PictureFormat, number> = { png: 0.39, jpg: 0.08, webp: 0.05 };

export function estimatePictureBytes(
  size: { width: number; height: number },
  format: PictureFormat,
): number {
  return size.width * size.height * PICTURE_BYTES_PER_PIXEL[format];
}

/** `14 MB`, `1.2 MB`, `640 KB`. */
export function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 10) return `${String(Math.round(mb))} MB`;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
}

/** `About 20 seconds left`, `About 2 minutes left`, `A few seconds left`. */
export function timeLeft(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 3) return "A few seconds left";
  if (seconds < 90) return `About ${String(Math.max(5, Math.round(seconds / 5) * 5))} seconds left`;
  return `About ${String(Math.round(seconds / 60))} minutes left`;
}

/** A file name from the name of a look: `Aurora night` -> `Aurora-night`. */
export function fileStem(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned === "" ? "Background" : cleaned.slice(0, 60);
}

export { posterSeconds };
