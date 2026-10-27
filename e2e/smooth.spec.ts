import { expect, test } from "@playwright/test";

/**
 * A picture much larger than it is shown must not turn crunchy: one-pixel stripes (the worst case for
 * a plain bilinear `drawImage`) have to come out as an even grey, not as stripes or moiré.
 */
test("a big picture drawn small is averaged, not skipped", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const path = "/src/editor/draw/smooth.ts";
    const { drawSmooth } = (await import(/* @vite-ignore */ path)) as {
      drawSmooth: (
        ctx: CanvasRenderingContext2D,
        image: CanvasImageSource,
        revision: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ) => void;
    };
    const source = document.createElement("canvas");
    source.width = 2400;
    source.height = 1200;
    const sctx = source.getContext("2d");
    if (!sctx) throw new Error("no 2d");
    sctx.fillStyle = "#fff";
    sctx.fillRect(0, 0, 2400, 1200);
    sctx.fillStyle = "#000";
    for (let x = 0; x < 2400; x += 2) sctx.fillRect(x, 0, 1, 1200);

    const spread = (draw: (ctx: CanvasRenderingContext2D) => void): number => {
      const out = document.createElement("canvas");
      out.width = 700;
      out.height = 350;
      const ctx = out.getContext("2d");
      if (!ctx) throw new Error("no 2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 700, 350);
      draw(ctx);
      const row = ctx.getImageData(50, 100, 600, 1).data;
      let min = 255;
      let max = 0;
      for (let i = 0; i < row.length; i += 4) {
        min = Math.min(min, row[i] ?? 0);
        max = Math.max(max, row[i] ?? 0);
      }
      return max - min;
    };
    // Shown at 0.25 of its size: 2400 px -> 600 px.
    const plain = spread((ctx) => {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(source, 0, 0, 700, 350);
    });
    const smooth = spread((ctx) => {
      drawSmooth(ctx, source, 1, 0, 0, 700, 350);
    });
    return { plain, smooth };
  });
  // The averaged picture is an even mid grey (the spread is a few levels at most) ...
  expect(result.smooth).toBeLessThan(24);
  // ... and it is much calmer than what a plain drawImage makes of the same picture.
  expect(result.smooth).toBeLessThanOrEqual(result.plain);
});
