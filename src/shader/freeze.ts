import { posterSeconds } from "./scene";
import { sharedRenderer } from "./renderer";
import type { ShaderScene } from "./types";

/** The longest side of a frozen frame (docs/FORMAT.md section 4c, "Frozen frames"). */
export const FREEZE_MAX_EDGE = 3840;

/**
 * One moment of a scene as a PNG, `width` x `height` (made smaller to fit 3840 on the long side or what the graphics card
 * allows). `null` where WebGL is missing. Used for "Use this frame as picture" and for exporting the background as a picture.
 */
export async function renderFramePng(
  scene: ShaderScene,
  width: number,
  height: number,
  seconds: number = posterSeconds(scene),
  allowCode: boolean = false,
): Promise<{ bytes: Uint8Array; width: number; height: number } | null> {
  const renderer = sharedRenderer("freeze");
  if (!renderer) return null;
  const k = Math.min(1, FREEZE_MAX_EDGE / Math.max(width, height, 1));
  const report = renderer.render(
    scene,
    seconds,
    Math.max(1, Math.round(width * k)),
    Math.max(1, Math.round(height * k)),
    { allowCode: () => allowCode },
  );
  if (!report.drawn) return null;
  // The canvas is only guaranteed to hold the picture until the next task: copy it before waiting for the encoder.
  const copy = document.createElement("canvas");
  copy.width = report.width;
  copy.height = report.height;
  const ctx = copy.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(renderer.canvas, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    copy.toBlob(resolve, "image/png");
  });
  if (!blob) return null;
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: report.width,
    height: report.height,
  };
}
