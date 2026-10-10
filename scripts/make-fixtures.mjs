#!/usr/bin/env node
// Writes the golden fixtures of format version 1 into fixtures/lumengrab/.
//
// This was run ONCE. The files it wrote are committed and must never be edited or regenerated
// (docs/FORMAT.md section 5, rule 7): they prove that every released version keeps opening.
// The script refuses to overwrite an existing file. To add fixtures for a new format version, copy
// this script's approach into a new script (or extend it with new names) and keep the old files.
//
// It deliberately does NOT use src/document: the fixtures are written by independent code (fflate for
// the ZIP, node:zlib for the PNGs, literals for the JSON), so a bug in our reader or writer cannot hide
// inside them. Next to each fixture goes `<name>.expected.json`: what a correct reader must produce.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { strToU8, zipSync } from "fflate";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "lumengrab");
mkdirSync(OUT, { recursive: true });

// ---- PNG ----------------------------------------------------------------------------------------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};
const png = (width, height, pixel) => {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) raw.set(pixel(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw, { level: 9 }))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const gradient = (w, h) => png(w, h, (x, y) => [(x * 255) / w, (y * 255) / h, 128, 255]);
const stripes = (w, h) => png(w, h, (x, y) => ((x + y) % 8 < 4 ? [0, 255, (x * 7) & 255, 255] : [255, 0, (y * 5) & 255, 255]));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ---- documents ----------------------------------------------------------------------------------
const presentation = (overrides = {}) => ({
  enabled: false,
  background: { type: "solid", color: "#F4F4F5" },
  padding: { top: 64, right: 64, bottom: 64, left: 64 },
  autoBalance: true,
  cornerRadius: 12,
  shadow: { enabled: true, x: 0, y: 20, blur: 50, spread: 0, color: "#00000040" },
  frame: { type: "none" },
  aspect: { mode: "free" },
  exportScale: 1,
  ...overrides,
});

const manifest = (id, source, png, extra = {}) => ({
  format: "lumengrab",
  formatVersion: 1,
  minReaderVersion: 1,
  createdBy: "LumenGrab 0.1.0 (fixture)",
  createdAt: "2026-10-06T12:00:00Z",
  modifiedAt: "2026-10-06T12:05:00Z",
  documentId: id,
  source: { file: "source.png", width: source.width, height: source.height, scale: 2, sha256: sha256(png) },
  ...extra,
});

const common = { visible: true, locked: false };
const allLayers = [
  { id: "a1", ...common, type: "arrow", from: { x: 4, y: 4 }, to: { x: 40, y: 30 }, style: "curved", color: "#EF4444", width: 3, curve: { x: 30, y: 6 } },
  { id: "a2", ...common, type: "arrow", from: { x: 4, y: 60 }, to: { x: 40, y: 50 }, style: "double", color: "#18181B", width: 2 },
  { id: "l1", ...common, type: "line", from: { x: 0, y: 32 }, to: { x: 96, y: 32 }, color: "#2563EB80", width: 2, dash: [4, 2] },
  { id: "r1", ...common, type: "rect", x: 10, y: 10, width: 30, height: 20, rotation: 15, stroke: "#000000", fill: null, strokeWidth: 2, radius: 4, name: "Frame" },
  { id: "e1", visible: false, locked: true, type: "ellipse", x: 50, y: 10, width: 30, height: 20, rotation: 0, stroke: null, fill: "#C8FF2E80", strokeWidth: 0 },
  { id: "t1", ...common, type: "text", x: 8, y: 8, width: null, text: "Hello fixture", fontId: "inter", size: 12, weight: 600, color: "#111111", background: "#FFFFFFCC", align: "left", rotation: 0 },
  { id: "c1", ...common, type: "counter", x: 70, y: 50, value: 3, color: "#EF4444", size: 14 },
  { id: "p1", ...common, type: "pencil", points: [0, 0, 5, 7, 12, 9, 20, 22], color: "#2563EB", width: 3, smoothing: 0.5 },
  { id: "h1", ...common, type: "highlighter", rect: { x: 8, y: 40, width: 40, height: 8 }, color: "#FDE047", opacity: 0.4 },
  { id: "s1", ...common, type: "spotlight", rect: { x: 20, y: 12, width: 50, height: 36 }, shape: "ellipse", dimOpacity: 0.6 },
  { id: "x1", ...common, type: "redaction", mode: "solid", rect: { x: 60, y: 4, width: 30, height: 10 }, strength: 0, color: "#000000", seed: 1 },
];

const fixtures = [];

{
  const source = { width: 48, height: 32 };
  const image = gradient(source.width, source.height);
  fixtures.push({
    name: "v1-minimal",
    manifest: manifest("00000000-0000-4000-8000-000000000001", source, image),
    project: { version: 1, crop: null, layers: [], presentation: presentation() },
    entries: { "source.png": [image, 0], "preview.png": [image, 0] },
    assets: [],
    extraEntries: [],
  });
}
{
  const source = { width: 96, height: 64 };
  const image = gradient(source.width, source.height);
  fixtures.push({
    name: "v1-all-layers",
    manifest: manifest("00000000-0000-4000-8000-000000000002", source, image),
    project: {
      version: 1,
      crop: null,
      layers: allLayers,
      presentation: presentation({
        enabled: true,
        background: { type: "gradient", angle: 135, stops: [{ offset: 0, color: "#C8FF2E" }, { offset: 0.5, color: "#2563EB" }, { offset: 1, color: "#18181B" }] },
        padding: { top: 48, right: 64, bottom: 80, left: 64 },
        autoBalance: false,
        cornerRadius: 16,
        shadow: { enabled: true, x: 4, y: 24, blur: 60, spread: 2, color: "#00000066" },
        frame: { type: "browser", title: "Fixture", url: "https://example.com/fixture" },
        aspect: { mode: "fixed", ratio: [16, 9] },
        exportScale: 2,
      }),
    },
    entries: { "source.png": [image, 0], "preview.png": [image, 0] },
    assets: [],
    extraEntries: [],
  });
}
{
  const source = { width: 96, height: 64 };
  const image = stripes(source.width, source.height);
  const redaction = (id, mode, rect, strength, extra = {}) => ({ id, ...common, type: "redaction", mode, rect, strength, seed: 1234, ...extra });
  fixtures.push({
    name: "v1-redactions",
    manifest: manifest("00000000-0000-4000-8000-000000000003", source, image),
    project: {
      version: 1,
      crop: { x: 8, y: 4, width: 80, height: 56 },
      layers: [
        redaction("b1", "blur", { x: 12, y: 8, width: 24, height: 16 }, 6),
        redaction("p1", "pixelate", { x: 44, y: 8, width: 24, height: 16 }, 8),
        redaction("s1", "solid", { x: 12, y: 36, width: 24, height: 16 }, 0, { color: "#000000" }),
      ],
      presentation: presentation(),
    },
    entries: { "source.png": [image, 0], "preview.png": [image, 0] },
    assets: [],
    extraEntries: [],
  });
}
{
  const source = { width: 64, height: 48 };
  const image = stripes(source.width, source.height);
  const asset = gradient(8, 8);
  const assetName = `${sha256(asset)}.png`;
  fixtures.push({
    name: "v1-unknown-fields",
    manifest: manifest("00000000-0000-4000-8000-000000000004", source, image, {
      futureManifestField: { note: "from a later 1.x writer", list: [1, 2, 3] },
    }),
    project: {
      version: 1,
      crop: null,
      futureProjectField: { keep: true },
      layers: [
        { id: "r1", ...common, type: "rect", x: 4, y: 4, width: 20, height: 10, rotation: 0, stroke: "#000000", fill: null, strokeWidth: 1, radius: 0, futureLayerField: "keep me" },
        { id: "st1", ...common, type: "stamp", shape: "star", points: 5 },
      ],
      presentation: presentation({
        enabled: true,
        background: { type: "image", asset: assetName, fit: "cover", tint: "#FF000040" },
        futurePresentationField: 7,
      }),
    },
    entries: {
      "source.png": [image, 0],
      "preview.png": [image, 0],
      [`assets/${assetName}`]: [asset, 0],
      "extra/notes.txt": [strToU8("An entry this version does not know. It must survive a save.\n"), 6],
    },
    assets: [assetName],
    extraEntries: ["extra/notes.txt"],
  });
}

for (const fixture of fixtures) {
  const target = join(OUT, `${fixture.name}.lumengrab`);
  const expected = join(OUT, `${fixture.name}.expected.json`);
  if (existsSync(target) || existsSync(expected)) {
    console.error(`${fixture.name}: already exists, refusing to overwrite (golden fixtures are never edited)`);
    process.exitCode = 1;
    continue;
  }
  const files = {
    "manifest.json": [strToU8(`${JSON.stringify(fixture.manifest, null, 2)}\n`), { level: 6, mtime: Date.UTC(2026, 0, 1) }],
    "project.json": [strToU8(`${JSON.stringify(fixture.project, null, 2)}\n`), { level: 6, mtime: Date.UTC(2026, 0, 1) }],
  };
  for (const [name, [data, level]] of Object.entries(fixture.entries)) files[name] = [data, { level, mtime: Date.UTC(2026, 0, 1) }];
  writeFileSync(target, zipSync(files));
  writeFileSync(
    expected,
    `${JSON.stringify(
      {
        manifest: fixture.manifest,
        project: fixture.project,
        assets: fixture.assets,
        extraEntries: fixture.extraEntries,
        warnings: [],
        readOnly: null,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`${fixture.name}: written`);
}
