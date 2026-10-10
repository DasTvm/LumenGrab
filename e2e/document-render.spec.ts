import { expect, test } from "@playwright/test";
import type * as CanvasCodec from "../src/document/render/canvas-codec";
import type * as Flatten from "../src/document/render/flatten";
import type * as Write from "../src/document/write";

// The format logic is tested in Node; this checks the one part that needs a real browser engine:
// the canvas codec that decodes and encodes PNGs in the WebView.
test("canvas codec: a redaction survives the real image pipeline and the original stays exact", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // The app's own modules, served by the dev server; the path is a variable so TypeScript does not resolve it.
    const load = async <T>(path: string): Promise<T> =>
      (await import(/* @vite-ignore */ path)) as T;
    const { canvasCodec: codec } = await load<typeof CanvasCodec>(
      "/src/document/render/canvas-codec.ts",
    );
    const { createDocument } = await load<typeof Write>("/src/document/write.ts");
    const { renderPreview, renderFlat } = await load<typeof Flatten>(
      "/src/document/render/flatten.ts",
    );

    // A 64 x 48 test picture, opaque stripes.
    const canvas = new OffscreenCanvas(64, 48);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    for (let x = 0; x < 64; x += 4) {
      ctx.fillStyle = (x / 4) % 2 ? "#ff0000" : "#00ff00";
      ctx.fillRect(x, 0, 4, 48);
    }
    const png = new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
    );

    const doc = await createDocument(png);
    if (!doc.project) throw new Error("project");
    doc.project.layers.push({
      id: "r",
      type: "redaction",
      visible: true,
      locked: false,
      mode: "solid",
      rect: { x: 8, y: 8, width: 24, height: 16 },
      strength: 0,
      color: "#123456",
      seed: 1,
    });
    const decoded = await codec.decode(png);
    const preview = await codec.decode(await renderPreview(doc, codec));
    const full = await codec.decode(await renderFlat(doc, codec));
    const px = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number) =>
      Array.from(img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4));
    return {
      size: [decoded.width, decoded.height],
      previewSize: [preview.width, preview.height],
      redacted: px(full, 10, 10),
      outsideNow: px(full, 40, 40),
      outsideWas: px(decoded, 40, 40),
      previewRedacted: px(preview, 10, 10),
      sourceUnchanged: px(decoded, 10, 10),
    };
  });
  expect(result.size).toEqual([64, 48]);
  expect(result.previewSize).toEqual([64, 48]); // small pictures are not scaled up
  expect(result.redacted).toEqual([0x12, 0x34, 0x56, 255]);
  expect(result.previewRedacted).toEqual([0x12, 0x34, 0x56, 255]);
  expect(result.outsideNow).toEqual(result.outsideWas);
  expect(result.sourceUnchanged).not.toEqual([0x12, 0x34, 0x56, 255]);
});
