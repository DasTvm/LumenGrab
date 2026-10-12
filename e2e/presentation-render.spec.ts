import { expect, test, type Page } from "@playwright/test";
import type * as CanvasCodec from "../src/document/render/canvas-codec";
import type * as Flatten from "../src/document/render/flatten";
import type * as Schema from "../src/document/schema";
import type * as Write from "../src/document/write";
import type * as EditorCodec from "../src/editor/draw/codec";

// The layout maths and the pixel functions are tested in Node; this renders a presentation through
// the real canvas (what the export, the preview and the clipboard use) and probes pixels.
type Patch = Partial<Schema.Presentation>;

async function render(page: Page, patch: Patch, probes: [number, number][], asset = false) {
  return page.evaluate(
    async ({ patch: input, probes: points, asset: withAsset }) => {
      const load = async <T>(path: string): Promise<T> =>
        (await import(/* @vite-ignore */ path)) as T;
      const { editorCodec } = await load<typeof EditorCodec>("/src/editor/draw/codec.ts");
      const { canvasCodec } = await load<typeof CanvasCodec>(
        "/src/document/render/canvas-codec.ts",
      );
      const { renderFlat } = await load<typeof Flatten>("/src/document/render/flatten.ts");
      const { createDocument } = await load<typeof Write>("/src/document/write.ts");

      const png = async (
        w: number,
        h: number,
        paint: (c: OffscreenCanvasRenderingContext2D) => void,
      ) => {
        const canvas = new OffscreenCanvas(w, h);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d context");
        paint(ctx);
        return new Uint8Array(
          await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
        );
      };
      // 200 x 100, left half red, right half blue.
      const source = await png(200, 100, (c) => {
        c.fillStyle = "#ff0000";
        c.fillRect(0, 0, 100, 100);
        c.fillStyle = "#0000ff";
        c.fillRect(100, 0, 100, 100);
      });
      const doc = await createDocument(source);
      if (!doc.project) throw new Error("project");
      doc.project.presentation = { ...doc.project.presentation, enabled: true, ...input };
      if (withAsset) {
        const asset = await png(8, 8, (c) => {
          c.fillStyle = "#00ff00";
          c.fillRect(0, 0, 8, 8);
        });
        doc.assets["a.png"] = asset;
      }
      const out = await canvasCodec.decode(await renderFlat(doc, editorCodec));
      const px = (x: number, y: number) =>
        Array.from(out.data.subarray((y * out.width + x) * 4, (y * out.width + x) * 4 + 4));
      return { size: [out.width, out.height], probes: points.map(([x, y]) => px(x, y)) };
    },
    { patch, probes, asset },
  );
}

const noShadow = { enabled: false, x: 0, y: 0, blur: 0, spread: 0, color: "#00000000" };
const pad = (n: number) => ({ top: n, right: n, bottom: n, left: n });

test("solid background with padding: the picture sits in the middle, the background around it", async ({
  page,
}) => {
  await page.goto("/");
  const r = await render(
    page,
    {
      background: { type: "solid", color: "#336699" },
      padding: pad(20),
      shadow: noShadow,
      cornerRadius: 0,
    },
    [
      [2, 2],
      [30, 50],
      [180, 50],
      [235, 130],
    ],
  );
  expect(r.size).toEqual([240, 140]);
  expect(r.probes[0]).toEqual([0x33, 0x66, 0x99, 255]);
  expect(r.probes[1]).toEqual([255, 0, 0, 255]);
  expect(r.probes[2]).toEqual([0, 0, 255, 255]);
  expect(r.probes[3]).toEqual([0x33, 0x66, 0x99, 255]);
});

test("a linear gradient runs from the first to the last colour and a rounded corner shows the background", async ({
  page,
}) => {
  await page.goto("/");
  const r = await render(
    page,
    {
      background: {
        type: "gradient",
        angle: 90,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
      padding: pad(40),
      shadow: noShadow,
      cornerRadius: 40,
    },
    [
      [1, 70],
      [279, 70],
      [41, 41],
      [80, 70],
    ],
  );
  expect(r.size).toEqual([280, 180]);
  expect(r.probes[0]?.[0]).toBeLessThan(10);
  expect(r.probes[1]?.[0]).toBeGreaterThan(245);
  // The corner of the picture (40, 40) is cut off by the radius: background, not the red picture.
  expect(r.probes[2]?.slice(0, 3)).not.toEqual([255, 0, 0]);
  expect(r.probes[3]).toEqual([255, 0, 0, 255]);
});

test("the shadow darkens the background below the picture and nothing above it", async ({
  page,
}) => {
  await page.goto("/");
  const r = await render(
    page,
    {
      background: { type: "solid", color: "#ffffff" },
      padding: pad(60),
      cornerRadius: 0,
      shadow: { enabled: true, x: 0, y: 30, blur: 40, spread: 0, color: "#000000cc" },
    },
    [
      [140, 168],
      [140, 4],
    ],
  );
  expect(r.probes[0]?.[0]).toBeLessThan(200);
  expect(r.probes[1]).toEqual([255, 255, 255, 255]);
});

test("a macOS frame adds a title bar with traffic lights above the picture", async ({ page }) => {
  await page.goto("/");
  const r = await render(
    page,
    {
      background: { type: "solid", color: "#ffffff" },
      padding: pad(10),
      shadow: noShadow,
      cornerRadius: 0,
      frame: { type: "macos-window", title: "Hello" },
    },
    [
      [200, 15],
      [20, 20],
      [60, 60],
    ],
  );
  // 200 px wide picture: k = 0.5, bar = 20, so the canvas is 220 x 140 and the bar sits at y 10..30.
  expect(r.size).toEqual([220, 140]);
  expect(r.probes[0]?.[0]).toBeGreaterThan(200); // the title bar, light grey, not the picture's red
  expect(r.probes[0]?.[1]).toBeGreaterThan(200);
  expect(r.probes[1]?.[0]).toBeGreaterThan(240); // the red traffic light
  expect(r.probes[1]?.[1]).toBeLessThan(130);
  expect(r.probes[2]).toEqual([255, 0, 0, 255]);
});

test("a social format is exported at exactly its pixel size", async ({ page }) => {
  await page.goto("/");
  const r = await render(
    page,
    {
      background: { type: "solid", color: "#101010" },
      padding: pad(16),
      shadow: noShadow,
      aspect: { mode: "fixed", ratio: [9, 16], size: [1080, 1920], preset: "instagram-story" },
    },
    [
      [540, 960],
      [5, 5],
    ],
  );
  expect(r.size).toEqual([1080, 1920]);
  expect(r.probes[1]).toEqual([0x10, 0x10, 0x10, 255]);
});

test("mesh, blurred screenshot and image backgrounds fill the canvas and the same input gives the same pixels", async ({
  page,
}) => {
  await page.goto("/");
  const probes: [number, number][] = [
    [3, 3],
    [236, 3],
    [3, 136],
    [236, 136],
  ];
  const mesh = await render(
    page,
    {
      background: { type: "mesh", seed: 3, colors: ["#ff0000", "#00ff00", "#0000ff", "#ffff00"] },
      padding: pad(20),
      shadow: noShadow,
    },
    probes,
  );
  expect(new Set(mesh.probes.map((p) => p.join(","))).size).toBeGreaterThan(2);
  const again = await render(
    page,
    {
      background: { type: "mesh", seed: 3, colors: ["#ff0000", "#00ff00", "#0000ff", "#ffff00"] },
      padding: pad(20),
      shadow: noShadow,
    },
    probes,
  );
  expect(again.probes).toEqual(mesh.probes);

  const blur = await render(
    page,
    {
      background: { type: "source-blur", blur: 30, zoom: 1.2, dim: 0, saturation: 1 },
      padding: pad(20),
      shadow: noShadow,
    },
    probes,
  );
  // The left of the picture is red and the right blue, so the blurred background is too.
  expect(blur.probes[0]?.[0]).toBeGreaterThan(blur.probes[0]?.[2] ?? 0);
  expect(blur.probes[1]?.[2]).toBeGreaterThan(blur.probes[1]?.[0] ?? 0);

  const image = await render(
    page,
    {
      background: { type: "image", asset: "a.png", fit: "cover" },
      padding: pad(20),
      shadow: noShadow,
    },
    probes,
    true,
  );
  expect(image.probes[0]).toEqual([0, 255, 0, 255]);
});
