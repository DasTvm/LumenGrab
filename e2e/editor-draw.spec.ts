import { expect, test } from "@playwright/test";
import type * as EditorCodec from "../src/editor/draw/codec";
import type * as CanvasCodec from "../src/document/render/canvas-codec";
import type * as Flatten from "../src/document/render/flatten";
import type * as Schema from "../src/document/schema";
import type * as Write from "../src/document/write";

// The drawing code runs in the real browser engine (canvas, fonts). The Node tests cover the maths
// (arrow shape, text layout, smoothing); this checks what ends up in the pixels, through the same path
// as the preview and the export: redactions first, annotations over them, then the crop.

type Layer = Schema.Layer;
const base = { visible: true, locked: false };

interface Probe {
  at: [number, number];
}

async function render(
  page: import("@playwright/test").Page,
  layers: Layer[],
  options: {
    crop?: { x: number; y: number; width: number; height: number };
    probes: Probe["at"][];
    counts?: [number, number, number, number][];
  },
) {
  return page.evaluate(
    async ({ layers: input, crop, probes, counts }) => {
      const load = async <T>(path: string): Promise<T> =>
        (await import(/* @vite-ignore */ path)) as T;
      const { editorCodec } = await load<typeof EditorCodec>("/src/editor/draw/codec.ts");
      const { canvasCodec } = await load<typeof CanvasCodec>(
        "/src/document/render/canvas-codec.ts",
      );
      const { renderFlat } = await load<typeof Flatten>("/src/document/render/flatten.ts");
      const { createDocument } = await load<typeof Write>("/src/document/write.ts");

      // 200 x 120, plain white.
      const canvas = new OffscreenCanvas(200, 120);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 200, 120);
      const png = new Uint8Array(
        await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
      );
      const doc = await createDocument(png);
      if (!doc.project) throw new Error("project");
      doc.project.layers = input;
      doc.project.crop = crop ?? null;

      const out = await editorCodec.decode(await renderFlat(doc, editorCodec));
      const px = (x: number, y: number) =>
        Array.from(out.data.subarray((y * out.width + x) * 4, (y * out.width + x) * 4 + 4));
      let withoutDrawer = "";
      try {
        await renderFlat(doc, canvasCodec);
      } catch (error) {
        withoutDrawer = (error as Error).message;
      }
      return {
        size: [out.width, out.height],
        pixels: probes.map(([x, y]) => px(x, y)),
        withoutDrawer,
        counts: counts.map(([x0, y0, x1, y1]) => {
          let n = 0;
          for (let y = y0; y < y1; y += 1)
            for (let x = x0; x < x1; x += 1)
              if (
                px(x, y)
                  .slice(0, 3)
                  .some((v) => v < 200)
              )
                n += 1;
          return n;
        }),
      };
    },
    { layers, crop: options.crop, probes: options.probes, counts: options.counts ?? [] },
  );
}

const WHITE = [255, 255, 255, 255];

test.describe("drawing in the browser engine", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("rectangle, ellipse, line", async ({ page }) => {
    const layers: Layer[] = [
      {
        id: "r",
        ...base,
        type: "rect",
        x: 10,
        y: 10,
        width: 40,
        height: 30,
        rotation: 0,
        stroke: null,
        fill: "#FF0000",
        strokeWidth: 0,
        radius: 0,
      },
      {
        id: "o",
        ...base,
        type: "rect",
        x: 60,
        y: 10,
        width: 40,
        height: 30,
        rotation: 0,
        stroke: "#0000FF",
        fill: null,
        strokeWidth: 4,
        radius: 0,
      },
      {
        id: "e",
        ...base,
        type: "ellipse",
        x: 110,
        y: 10,
        width: 60,
        height: 30,
        rotation: 0,
        stroke: null,
        fill: "#00FF00",
        strokeWidth: 0,
      },
      {
        id: "l",
        ...base,
        type: "line",
        from: { x: 10, y: 60 },
        to: { x: 110, y: 60 },
        color: "#000000",
        width: 4,
      },
    ];
    const r = await render(page, layers, {
      probes: [
        [30, 25],
        [80, 25],
        [60, 25],
        [140, 25],
        [112, 11],
        [60, 60],
        [60, 70],
      ],
    });
    expect(r.pixels[0]).toEqual([255, 0, 0, 255]); // filled rect
    expect(r.pixels[1]).toEqual(WHITE); // outline only: the inside stays
    expect(r.pixels[2]).toEqual([0, 0, 255, 255]); // on the outline (x = 60, centred on the edge)
    expect(r.pixels[3]).toEqual([0, 255, 0, 255]); // inside the ellipse
    expect(r.pixels[4]).toEqual(WHITE); // corner of the ellipse's box
    expect(r.pixels[5]).toEqual([0, 0, 0, 255]); // the line
    expect(r.pixels[6]).toEqual(WHITE);
  });

  test("a rotated rectangle turns around its centre, clockwise", async ({ page }) => {
    const layers: Layer[] = [
      {
        id: "r",
        ...base,
        type: "rect",
        x: 50,
        y: 50,
        width: 100,
        height: 10,
        rotation: 90,
        stroke: null,
        fill: "#000000",
        strokeWidth: 0,
        radius: 0,
      },
    ];
    const r = await render(page, layers, {
      probes: [
        [100, 10],
        [100, 100],
        [55, 55],
        [100, 55],
      ],
    });
    expect(r.pixels[0]).toEqual([0, 0, 0, 255]); // now tall: reaches up from the centre (100, 55)
    expect(r.pixels[1]).toEqual([0, 0, 0, 255]);
    expect(r.pixels[2]).toEqual(WHITE); // the old left end
    expect(r.pixels[3]).toEqual([0, 0, 0, 255]);
  });

  test("arrows: head at the end, double has two, outlined has a white head", async ({ page }) => {
    const arrow = (id: string, y: number, style: string): Layer => ({
      id,
      ...base,
      type: "arrow",
      from: { x: 20, y },
      to: { x: 120, y },
      style,
      color: "#D00000",
      width: 4,
    });
    const r = await render(
      page,
      [arrow("a", 20, "straight"), arrow("b", 60, "double"), arrow("c", 100, "outlined")],
      {
        probes: [
          [70, 20],
          [118, 20],
          [22, 20],
          [22, 60],
          [118, 60],
          [108, 100],
          [119, 100],
        ],
      },
    );
    expect(r.pixels[0]).toEqual([208, 0, 0, 255]); // shaft
    expect(r.pixels[1]).toEqual([208, 0, 0, 255]); // inside the head (tip is at 120)
    expect(r.pixels[2]).toEqual([208, 0, 0, 255]); // round cap of the shaft's start
    expect(r.pixels[3]).toEqual([208, 0, 0, 255]); // double: head at the start
    expect(r.pixels[4]).toEqual([208, 0, 0, 255]); // double: head at the end
    expect(r.pixels[5]).toEqual(WHITE); // outlined head is hollow
    expect(r.pixels[6]?.[0] ?? 0).toBeGreaterThan(150); // but its outline reaches the tip
  });

  test("a curved arrow leaves the straight line", async ({ page }) => {
    const layers: Layer[] = [
      {
        id: "a",
        ...base,
        type: "arrow",
        from: { x: 20, y: 100 },
        to: { x: 180, y: 100 },
        style: "curved",
        curve: { x: 100, y: 20 },
        color: "#000000",
        width: 3,
      },
    ];
    const r = await render(page, layers, {
      probes: [[100, 100]],
      counts: [[85, 50, 115, 70]],
    });
    expect(r.pixels[0]).toEqual(WHITE); // the straight line is not drawn
    expect(r.counts[0]).toBeGreaterThan(30); // the bend passes half way to the control point
  });

  test("text is drawn with the bundled font, a background and wrapping", async ({ page }) => {
    const text = (extra: object): Layer => ({
      id: "t",
      ...base,
      type: "text",
      x: 10,
      y: 10,
      width: null,
      text: "Hello",
      fontId: "inter",
      size: 24,
      weight: 600,
      color: "#000000",
      background: null,
      align: "left",
      rotation: 0,
      ...extra,
    });
    const plain = await render(page, [text({})], {
      probes: [],
      counts: [
        [10, 10, 100, 45],
        [120, 10, 200, 45],
      ],
    });
    expect(plain.counts[0]).toBeGreaterThan(80);
    expect(plain.counts[1]).toBe(0);

    const boxed = await render(page, [text({ background: "#FFFF00" })], {
      probes: [
        [5, 5],
        [1, 1],
      ],
    });
    expect(boxed.pixels[0]).toEqual([255, 255, 0, 255]); // inside the padding (0.3 x size = 7.2)
    expect(boxed.pixels[1]).toEqual(WHITE);

    const wrapped = await render(page, [text({ text: "aaa bbb ccc ddd", width: 60 })], {
      probes: [],
      counts: [
        [10, 52, 70, 100],
        [75, 10, 200, 100],
      ],
    });
    expect(wrapped.counts[0]).toBeGreaterThan(40); // text continues on later lines
    expect(wrapped.counts[1]).toBe(0); // and never leaves the width
  });

  test("a counter is a filled circle with a readable number", async ({ page }) => {
    const layers: Layer[] = [
      { id: "c", ...base, type: "counter", x: 50, y: 50, value: 7, color: "#EF4444", size: 40 },
    ];
    const r = await render(page, layers, {
      probes: [
        [34, 50],
        [50, 50],
        [50, 25],
        [75, 75],
      ],
      counts: [[40, 38, 60, 62]],
    });
    expect(r.pixels[0]).toEqual([239, 68, 68, 255]);
    expect(r.pixels[2]).toEqual(WHITE); // above the circle
    expect(r.pixels[3]).toEqual(WHITE); // the box corner is outside the circle
    expect(r.counts[0]).toBeGreaterThan(300);
  });

  test("a pencil stroke follows its points; a single point is a dot", async ({ page }) => {
    const layers: Layer[] = [
      {
        id: "p",
        ...base,
        type: "pencil",
        points: [10, 20, 90, 20],
        color: "#000000",
        width: 6,
        smoothing: 0.5,
      },
      {
        id: "d",
        ...base,
        type: "pencil",
        points: [100, 80],
        color: "#000000",
        width: 12,
        smoothing: 0,
      },
    ];
    const r = await render(page, layers, {
      probes: [
        [50, 20],
        [50, 30],
        [100, 80],
        [112, 80],
      ],
    });
    expect(r.pixels[0]).toEqual([0, 0, 0, 255]);
    expect(r.pixels[1]).toEqual(WHITE);
    expect(r.pixels[2]).toEqual([0, 0, 0, 255]);
    expect(r.pixels[3]).toEqual(WHITE);
  });

  test("a highlighter multiplies: text under it stays dark, white becomes the colour", async ({
    page,
  }) => {
    const layers: Layer[] = [
      {
        id: "b",
        ...base,
        type: "rect",
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        rotation: 0,
        stroke: null,
        fill: "#000000",
        strokeWidth: 0,
        radius: 0,
      },
      {
        id: "h",
        ...base,
        type: "highlighter",
        rect: { x: 0, y: 0, width: 60, height: 40 },
        color: "#FFFF00",
        opacity: 1,
      },
    ];
    const r = await render(page, layers, {
      probes: [
        [20, 20],
        [50, 20],
        [100, 100],
      ],
    });
    expect(r.pixels[0]).toEqual([0, 0, 0, 255]);
    expect(r.pixels[1]).toEqual([255, 255, 0, 255]);
    expect(r.pixels[2]).toEqual(WHITE);
  });

  test("a spotlight dims everything outside its shape", async ({ page }) => {
    const rectSpot = await render(
      page,
      [
        {
          id: "s",
          ...base,
          type: "spotlight",
          rect: { x: 50, y: 30, width: 60, height: 40 },
          shape: "rect",
          dimOpacity: 0.5,
        },
      ],
      {
        probes: [
          [80, 50],
          [5, 5],
          [190, 110],
        ],
      },
    );
    expect(rectSpot.pixels[0]).toEqual(WHITE);
    expect(rectSpot.pixels[1]).toEqual([127, 127, 127, 255]);
    expect(rectSpot.pixels[2]).toEqual([127, 127, 127, 255]);
    const ellipseSpot = await render(
      page,
      [
        {
          id: "s",
          ...base,
          type: "spotlight",
          rect: { x: 50, y: 30, width: 60, height: 40 },
          shape: "ellipse",
          dimOpacity: 0.5,
        },
      ],
      {
        probes: [
          [80, 50],
          [52, 32],
        ],
      },
    );
    expect(ellipseSpot.pixels[0]).toEqual(WHITE);
    expect(ellipseSpot.pixels[1]).toEqual([127, 127, 127, 255]); // the corner of the box is outside the ellipse
  });

  test("hidden layers and hidden groups are not drawn, visible groups draw their children in order", async ({
    page,
  }) => {
    const filled = (id: string, x: number, color: string, extra: object = {}): Layer => ({
      id,
      ...base,
      type: "rect",
      x,
      y: 10,
      width: 20,
      height: 20,
      rotation: 0,
      stroke: null,
      fill: color,
      strokeWidth: 0,
      radius: 0,
      ...extra,
    });
    const layers: Layer[] = [
      filled("a", 10, "#FF0000", { visible: false }),
      {
        id: "g",
        ...base,
        type: "group",
        layers: [filled("b", 40, "#00FF00"), filled("c", 50, "#0000FF")],
      },
      {
        id: "h",
        ...base,
        visible: false,
        type: "group",
        layers: [filled("d", 100, "#000000")],
      },
    ];
    const r = await render(page, layers, {
      probes: [
        [15, 20],
        [45, 20],
        [55, 20],
        [105, 20],
      ],
    });
    expect(r.pixels[0]).toEqual(WHITE);
    expect(r.pixels[1]).toEqual([0, 255, 0, 255]);
    expect(r.pixels[2]).toEqual([0, 0, 255, 255]); // c is above b where they overlap (x 50..60)
    expect(r.pixels[3]).toEqual(WHITE);
  });

  test("redactions are baked first and annotations are drawn over them; the crop is taken last", async ({
    page,
  }) => {
    const layers: Layer[] = [
      {
        id: "x",
        ...base,
        type: "redaction",
        mode: "solid",
        rect: { x: 0, y: 0, width: 50, height: 40 },
        strength: 0,
        color: "#000000",
        seed: 1,
      },
      // However the two are ordered in the file, the annotation ends up on top: the redaction destroys pixels first.
      {
        id: "r",
        ...base,
        type: "rect",
        x: 20,
        y: 20,
        width: 20,
        height: 20,
        rotation: 0,
        stroke: null,
        fill: "#FFFF00",
        strokeWidth: 0,
        radius: 0,
      },
    ];
    const r = await render(page, layers, {
      crop: { x: 10, y: 10, width: 60, height: 50 },
      probes: [
        [5, 5],
        [20, 20],
        [65, 45],
      ],
    });
    expect(r.size).toEqual([60, 50]);
    expect(r.pixels[0]).toEqual([0, 0, 0, 255]); // redacted, inside the crop
    expect(r.pixels[1]).toEqual([255, 255, 0, 255]); // the rectangle at (30, 30) of the source
    expect(r.pixels[2]).toEqual(WHITE); // outside the redaction
  });

  test("a codec that cannot draw refuses an annotated document instead of dropping the annotations", async ({
    page,
  }) => {
    const layers: Layer[] = [
      {
        id: "r",
        ...base,
        type: "rect",
        x: 1,
        y: 1,
        width: 5,
        height: 5,
        rotation: 0,
        stroke: null,
        fill: "#000000",
        strokeWidth: 0,
        radius: 0,
      },
    ];
    const r = await render(page, layers, { probes: [] });
    expect(r.withoutDrawer).toMatch(/cannot draw annotations/);
  });
});
