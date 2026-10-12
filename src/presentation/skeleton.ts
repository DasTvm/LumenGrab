import type { Ctx2D } from "@/editor/draw/draw";

/**
 * A skeleton-screen picture of an app (a sidebar, a title and grey lines), drawn in code. It stands in for
 * a screenshot where a look is shown without one: the look gallery, the Settings preview. Not artwork
 * of anyone else: plain rectangles.
 */
export function drawSkeleton(ctx: Ctx2D, width: number, height: number): void {
  const u = width / 640;
  ctx.save();
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#F4F4F5";
  ctx.fillRect(0, 0, 150 * u, height);
  ctx.fillStyle = "#E4E4E7";
  for (let i = 0; i < 5; i += 1)
    ctx.fillRect(18 * u, (30 + i * 26) * u, (i % 2 ? 80 : 100) * u, 10 * u);
  ctx.fillStyle = "#C8FF2E";
  ctx.fillRect(180 * u, 28 * u, 120 * u, 20 * u);
  ctx.fillStyle = "#E4E4E7";
  for (let i = 0; i < 6; i += 1) {
    const w = (i % 3 === 2 ? 270 : 420) * u;
    ctx.fillRect(180 * u, (76 + i * 34) * u, w, 14 * u);
  }
  ctx.restore();
}

export function skeletonCanvas(width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (ctx) drawSkeleton(ctx, width, height);
  return canvas;
}
