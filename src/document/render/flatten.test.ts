import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { openDocument } from "../read";
import type { Layer } from "../schema";
import { asImage, decodePng, encodePng, nodeCodec, stripes } from "../testing/png";
import { createDocument, serializeDocument } from "../write";
import {
  flattenImage,
  hasAnnotations,
  PREVIEW_MAX_EDGE,
  renderFlat,
  renderPreview,
} from "./flatten";

const FIXTURES = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "lumengrab",
);
const fixture = (name: string) =>
  openDocument(new Uint8Array(readFileSync(join(FIXTURES, `${name}.lumengrab`))));

describe("flattening", () => {
  it("bakes redactions into the full picture before cropping, and does not touch the source", async () => {
    const { doc } = await fixture("v1-redactions");
    if (!doc.project) throw new Error("fixture has a project");
    const source = await nodeCodec.decode(doc.source);
    const before = new Uint8ClampedArray(source.data);
    const flat = flattenImage(source, doc.project);

    expect(source.data).toEqual(before); // the original image is never modified
    expect([flat.width, flat.height]).toEqual([80, 56]); // the crop

    const crop = { x: 8, y: 4 };
    const at = (img: { width: number; data: Uint8ClampedArray }, x: number, y: number) => [
      ...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3),
    ];

    // The solid redaction (source x 12..36, y 36..52): every pixel is black in the result.
    for (let y = 36; y < 52; y += 1) {
      for (let x = 12; x < 36; x += 1) expect(at(flat, x - crop.x, y - crop.y)).toEqual([0, 0, 0]);
    }
    // Blur and pixelate: no pixel of those rectangles still equals the source.
    for (const [rx, ry] of [
      [12, 8],
      [44, 8],
    ] as const) {
      let same = 0;
      for (let y = ry; y < ry + 16; y += 1) {
        for (let x = rx; x < rx + 24; x += 1) {
          const now = at(flat, x - crop.x, y - crop.y);
          const was = [
            ...before.subarray((y * source.width + x) * 4, (y * source.width + x) * 4 + 3),
          ];
          if (now.every((v, i) => Math.abs(v - (was[i] ?? 0)) < 1)) same += 1;
        }
      }
      expect(same, `redaction at ${String(rx)},${String(ry)}`).toBe(0);
    }
    // A pixel far from every redaction is unchanged.
    expect(at(flat, 70, 50)).toEqual([
      ...before.subarray(
        ((50 + crop.y) * source.width + 70 + crop.x) * 4,
        ((50 + crop.y) * source.width + 70 + crop.x) * 4 + 3,
      ),
    ]);
  });

  it("a redaction cannot be cropped away: the crop is taken after it, from the redacted picture", async () => {
    const png = encodePng(stripes(40, 40));
    const doc = await createDocument(png);
    if (!doc.project) throw new Error("new documents have a project");
    doc.project.crop = { x: 10, y: 10, width: 20, height: 20 };
    doc.project.layers.push({
      id: "r",
      type: "redaction",
      visible: true,
      locked: false,
      mode: "solid",
      rect: { x: 0, y: 0, width: 40, height: 40 },
      strength: 0,
      color: "#123456",
      seed: 1,
    });
    const out = decodePng(await renderFlat(doc, nodeCodec));
    expect([out.width, out.height]).toEqual([20, 20]);
    expect([...out.data.subarray(0, 4)]).toEqual([0x12, 0x34, 0x56, 255]);
  });

  it("does not apply a hidden redaction", async () => {
    const png = encodePng(stripes(16, 16));
    const doc = await createDocument(png);
    if (!doc.project) throw new Error("new documents have a project");
    doc.project.layers.push({
      id: "r",
      type: "redaction",
      visible: false,
      locked: false,
      mode: "solid",
      rect: { x: 0, y: 0, width: 16, height: 16 },
      strength: 0,
      color: "#000000",
      seed: 1,
    });
    expect(decodePng(await renderFlat(doc, nodeCodec)).data).toEqual(decodePng(png).data);
  });
});

describe("groups", () => {
  const solid = (id: string, visible: boolean, x: number, color: string) => ({
    id,
    type: "redaction" as const,
    visible,
    locked: false,
    mode: "solid" as const,
    rect: { x, y: 0, width: 4, height: 16 },
    strength: 0,
    color,
    seed: 1,
  });
  const group = (id: string, visible: boolean, layers: Layer[]): Layer => ({
    id,
    type: "group",
    visible,
    locked: false,
    layers,
  });

  it("bakes a redaction that sits inside (nested) groups, and skips one inside a hidden group", async () => {
    const png = encodePng(stripes(16, 16));
    const doc = await createDocument(png);
    if (!doc.project) throw new Error("new documents have a project");
    doc.project.layers.push(
      group("g1", true, [group("g2", true, [solid("a", true, 0, "#112233")])]),
      group("g3", false, [solid("b", true, 8, "#445566")]),
      group("g4", true, [solid("c", false, 12, "#778899")]),
    );
    const out = decodePng(await renderFlat(doc, nodeCodec));
    const src = decodePng(png);
    const px = (img: { data: Uint8ClampedArray | Uint8Array }, x: number) => [
      ...img.data.subarray((3 * 16 + x) * 4, (3 * 16 + x) * 4 + 4),
    ];
    expect(px(out, 1)).toEqual([0x11, 0x22, 0x33, 255]); // nested, visible: destroyed
    expect(px(out, 9)).toEqual(px(src, 9)); // hidden group: not rendered
    expect(px(out, 13)).toEqual(px(src, 13)); // hidden layer in a visible group
  });

  it("sees annotations inside groups", async () => {
    const { doc } = await fixture("v2-groups");
    expect(doc.project && hasAnnotations(doc.project)).toBe(true);
  });
});

describe("preview and export", () => {
  it("renders a preview of at most 1024 px on the long edge", async () => {
    const doc = await createDocument(encodePng(stripes(3000, 1000)));
    const preview = decodePng(await renderPreview(doc, nodeCodec));
    expect([preview.width, preview.height]).toEqual([PREVIEW_MAX_EDGE, 341]);
  });

  it("renders the export at full resolution", async () => {
    const doc = await createDocument(encodePng(stripes(1500, 600)));
    const out = decodePng(await renderFlat(doc, nodeCodec));
    expect([out.width, out.height]).toEqual([1500, 600]);
  });

  it("leaves a small picture at its size", async () => {
    const doc = await createDocument(encodePng(stripes(50, 30)));
    const preview = decodePng(await renderPreview(doc, nodeCodec));
    expect([preview.width, preview.height]).toEqual([50, 30]);
  });

  it("the preview inside a saved file does not contain the pixels under a redaction", async () => {
    const png = encodePng(stripes(64, 48));
    const doc = await createDocument(png);
    if (!doc.project) throw new Error("new documents have a project");
    doc.project.layers.push({
      id: "r",
      type: "redaction",
      visible: true,
      locked: false,
      mode: "blur",
      rect: { x: 8, y: 8, width: 32, height: 24 },
      strength: 4,
      seed: 3,
    });
    const saved = serializeDocument(doc, await renderPreview(doc, nodeCodec));
    const { doc: reopened } = await openDocument(saved);
    const preview = decodePng(reopened.preview ?? new Uint8Array());
    const source = asImage(decodePng(png));
    let same = 0;
    for (let y = 8; y < 32; y += 1) {
      for (let x = 8; x < 40; x += 1) {
        const at = (y * 64 + x) * 4;
        if (
          [0, 1, 2].every(
            (c) => Math.abs((preview.data[at + c] ?? 0) - (source.data[at + c] ?? 0)) < 1,
          )
        )
          same += 1;
      }
    }
    expect(same).toBe(0);
    expect(reopened.source).toEqual(png); // while the file still holds the original, by design
  });

  it("refuses to render a document that is open read-only", async () => {
    const doc = await createDocument(encodePng(stripes(8, 8)));
    await expect(renderPreview({ ...doc, project: null }, nodeCodec)).rejects.toThrow(/read-only/);
    await expect(renderFlat({ ...doc, project: null }, nodeCodec)).rejects.toThrow(/read-only/);
  });
});

describe("hasAnnotations", () => {
  it("is true only for layers that are drawn over the picture", async () => {
    const { doc: plain } = await fixture("v1-redactions");
    expect(plain.project && hasAnnotations(plain.project)).toBe(false);
    const { doc: full } = await fixture("v1-all-layers");
    expect(full.project && hasAnnotations(full.project)).toBe(true);
    const { doc: minimal } = await fixture("v1-minimal");
    expect(minimal.project && hasAnnotations(minimal.project)).toBe(false);
  });
});
