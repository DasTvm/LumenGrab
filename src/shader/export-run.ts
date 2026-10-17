import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality as MediaQualityClass,
  WebMOutputFormat,
  canEncodeVideo,
} from "mediabunny";
import { applyPalette, GIFEncoder, quantize } from "gifenc";
import { computeLayout } from "@/presentation/compose";
import { drawComposition, drawShaderBackground } from "@/presentation/draw-presentation";
import type { Presentation } from "@/document/schema";
import {
  frameTime,
  type Content,
  type PictureFormat,
  type Quality,
  type VideoFormat,
} from "./export-model";
import { posterSeconds } from "./scene";
import type { ShaderScene } from "./types";

/**
 * Makes the files of the Studio's Export dialog: frames of the scene with or without the screenshot, encoded as MP4
 * or WebM by the browser's own encoder (WebCodecs, put in a file by mediabunny), as a GIF, or as one picture. Nothing
 * leaves the computer. A cancel stops between two frames and frees everything.
 */

export class ExportCancelled extends Error {
  constructor() {
    super("The export was cancelled.");
  }
}

export interface FrameSource {
  width: number;
  height: number;
  /** Draws the picture at `seconds` into `canvas` (the same size as above). */
  draw(canvas: HTMLCanvasElement, seconds: number): void;
}

/**
 * The frames of a presentation: the moving background at each moment, and over it the part that stands still (shadow,
 * window, screenshot), drawn once. `content: "background"` is the background alone.
 */
export function makeFrameSource(options: {
  scene: ShaderScene;
  presentation: Presentation;
  picture: { width: number; height: number };
  /** The finished screenshot (annotations drawn, crop taken). */
  content: CanvasImageSource;
  mode: Content;
  width: number;
  height: number;
}): FrameSource {
  const { scene, width, height } = options;
  let overlay: HTMLCanvasElement | null = null;
  if (options.mode === "composition") {
    const presentation = {
      ...options.presentation,
      enabled: true,
      background: { type: "transparent" as const },
    };
    const layout = computeLayout(options.picture, presentation);
    overlay = document.createElement("canvas");
    overlay.width = width;
    overlay.height = height;
    const ctx = overlay.getContext("2d");
    if (!ctx) throw new Error("This system cannot process images in the browser engine.");
    ctx.scale(width / layout.canvas.width, height / layout.canvas.height);
    drawComposition(ctx, { content: options.content, presentation }, layout, 1);
  }
  return {
    width,
    height,
    draw(canvas, seconds) {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("This system cannot process images in the browser engine.");
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      drawShaderBackground(ctx, scene, width, height, 1, { seconds, purpose: "export" });
      if (overlay) ctx.drawImage(overlay, 0, 0);
    },
  };
}

const QUALITIES: Record<Quality, MediaQualityClass> = {
  high: new MediaQualityClass("high"),
  medium: new MediaQualityClass("medium"),
  low: new MediaQualityClass("low"),
};

/** Whether this computer can make a video of the format at this size (MP4 needs an H.264 encoder, WebM VP9 or VP8). */
export async function canMakeVideo(
  format: VideoFormat,
  width: number,
  height: number,
): Promise<boolean> {
  try {
    if (typeof VideoEncoder === "undefined") return false;
    const codecs = format === "mp4" ? (["avc"] as const) : (["vp9", "vp8"] as const);
    for (const codec of codecs) {
      if (await canEncodeVideo(codec, { width, height })) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface Progress {
  frame: number;
  total: number;
  /** Seconds the rest will take at this speed. */
  secondsLeft: number;
}

function reporter(total: number, onProgress: (p: Progress) => void) {
  const started = performance.now();
  return (frame: number) => {
    const spent = (performance.now() - started) / 1000;
    onProgress({
      frame,
      total,
      secondsLeft: frame > 0 ? (spent / frame) * (total - frame) : Number.NaN,
    });
  };
}

/** A video of `frames` frames at `fps` frames a second. */
export async function makeVideo(options: {
  source: FrameSource;
  scene: ShaderScene;
  format: VideoFormat;
  quality: Quality;
  fps: number;
  frames: number;
  signal: AbortSignal;
  onProgress: (p: Progress) => void;
}): Promise<Uint8Array> {
  const { source, scene, format, fps, frames, signal } = options;
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const output = new Output({
    format: format === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  let codec: "avc" | "vp9" | "vp8" = "avc";
  if (format === "webm") {
    codec = (await canEncodeVideo("vp9", { width: source.width, height: source.height }))
      ? "vp9"
      : "vp8";
  }
  const video = new CanvasSource(canvas, { codec, quality: QUALITIES[options.quality] });
  output.addVideoTrack(video, { frameRate: fps });
  const report = reporter(frames, options.onProgress);
  try {
    await output.start();
    for (let i = 0; i < frames; i += 1) {
      if (signal.aborted) throw new ExportCancelled();
      // The loop repeats: frame i of a second round is the same moment of the loop as frame i of the first.
      source.draw(canvas, frameTime(i, fps) % scene.loop);
      await video.add(frameTime(i, fps), 1 / fps);
      report(i + 1);
      // Give the page a moment, so the window does not freeze while it works.
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
    await output.finalize();
  } catch (error) {
    if (output.state !== "finalized" && output.state !== "canceled")
      await output.cancel().catch(() => undefined);
    throw error;
  }
  const buffer = output.target.buffer;
  if (!buffer) throw new Error("The video could not be made.");
  return new Uint8Array(buffer);
}

/** A GIF that loops for ever. */
export async function makeGif(options: {
  source: FrameSource;
  scene: ShaderScene;
  colours: number;
  fps: number;
  frames: number;
  signal: AbortSignal;
  onProgress: (p: Progress) => void;
}): Promise<Uint8Array> {
  const { source, scene, fps, frames, signal } = options;
  const canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This system cannot process images in the browser engine.");
  const gif = GIFEncoder();
  const report = reporter(frames, options.onProgress);
  for (let i = 0; i < frames; i += 1) {
    if (signal.aborted) throw new ExportCancelled();
    source.draw(canvas, frameTime(i, fps) % scene.loop);
    const { data } = ctx.getImageData(0, 0, source.width, source.height);
    const palette = quantize(data, options.colours);
    gif.writeFrame(applyPalette(data, palette), source.width, source.height, {
      palette,
      delay: Math.round(1000 / fps),
      repeat: 0,
    });
    report(i + 1);
    if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0));
  }
  gif.finish();
  return gif.bytes();
}

const MIME: Record<PictureFormat, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

/** One picture of the scene at its still-frame moment (or at `seconds`). */
export async function makePicture(options: {
  source: FrameSource;
  scene: ShaderScene;
  format: PictureFormat;
  seconds?: number;
}): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = options.source.width;
  canvas.height = options.source.height;
  options.source.draw(canvas, options.seconds ?? posterSeconds(options.scene));
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, MIME[options.format], 0.92);
  });
  if (!blob) throw new Error("The picture could not be made.");
  return new Uint8Array(await blob.arrayBuffer());
}
