#!/usr/bin/env node
// Writes the golden fixtures of every format version into fixtures/lumengrab/ (v1: first run, v2: the
// `group` layer, v3: the presentation features of M5, v4: shader backgrounds of M5b).
//
// Each fixture was written ONCE. The files are committed and must never be edited or regenerated
// (docs/FORMAT.md section 5, rule 7): they prove that every released version keeps opening.
// The script never overwrites an existing file: a fixture that already exists is kept and reported.
// A new format version adds new fixtures below; the old ones stay as they are.
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
const stripes = (w, h) =>
  png(w, h, (x, y) =>
    (x + y) % 8 < 4 ? [0, 255, (x * 7) & 255, 255] : [255, 0, (y * 5) & 255, 255],
  );
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
  source: {
    file: "source.png",
    width: source.width,
    height: source.height,
    scale: 2,
    sha256: sha256(png),
  },
  ...extra,
});

const common = { visible: true, locked: false };
const allLayers = [
  {
    id: "a1",
    ...common,
    type: "arrow",
    from: { x: 4, y: 4 },
    to: { x: 40, y: 30 },
    style: "curved",
    color: "#EF4444",
    width: 3,
    curve: { x: 30, y: 6 },
  },
  {
    id: "a2",
    ...common,
    type: "arrow",
    from: { x: 4, y: 60 },
    to: { x: 40, y: 50 },
    style: "double",
    color: "#18181B",
    width: 2,
  },
  {
    id: "l1",
    ...common,
    type: "line",
    from: { x: 0, y: 32 },
    to: { x: 96, y: 32 },
    color: "#2563EB80",
    width: 2,
    dash: [4, 2],
  },
  {
    id: "r1",
    ...common,
    type: "rect",
    x: 10,
    y: 10,
    width: 30,
    height: 20,
    rotation: 15,
    stroke: "#000000",
    fill: null,
    strokeWidth: 2,
    radius: 4,
    name: "Frame",
  },
  {
    id: "e1",
    visible: false,
    locked: true,
    type: "ellipse",
    x: 50,
    y: 10,
    width: 30,
    height: 20,
    rotation: 0,
    stroke: null,
    fill: "#C8FF2E80",
    strokeWidth: 0,
  },
  {
    id: "t1",
    ...common,
    type: "text",
    x: 8,
    y: 8,
    width: null,
    text: "Hello fixture",
    fontId: "inter",
    size: 12,
    weight: 600,
    color: "#111111",
    background: "#FFFFFFCC",
    align: "left",
    rotation: 0,
  },
  { id: "c1", ...common, type: "counter", x: 70, y: 50, value: 3, color: "#EF4444", size: 14 },
  {
    id: "p1",
    ...common,
    type: "pencil",
    points: [0, 0, 5, 7, 12, 9, 20, 22],
    color: "#2563EB",
    width: 3,
    smoothing: 0.5,
  },
  {
    id: "h1",
    ...common,
    type: "highlighter",
    rect: { x: 8, y: 40, width: 40, height: 8 },
    color: "#FDE047",
    opacity: 0.4,
  },
  {
    id: "s1",
    ...common,
    type: "spotlight",
    rect: { x: 20, y: 12, width: 50, height: 36 },
    shape: "ellipse",
    dimOpacity: 0.6,
  },
  {
    id: "x1",
    ...common,
    type: "redaction",
    mode: "solid",
    rect: { x: 60, y: 4, width: 30, height: 10 },
    strength: 0,
    color: "#000000",
    seed: 1,
  },
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
        background: {
          type: "gradient",
          angle: 135,
          stops: [
            { offset: 0, color: "#C8FF2E" },
            { offset: 0.5, color: "#2563EB" },
            { offset: 1, color: "#18181B" },
          ],
        },
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
  const redaction = (id, mode, rect, strength, extra = {}) => ({
    id,
    ...common,
    type: "redaction",
    mode,
    rect,
    strength,
    seed: 1234,
    ...extra,
  });
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
        {
          id: "r1",
          ...common,
          type: "rect",
          x: 4,
          y: 4,
          width: 20,
          height: 10,
          rotation: 0,
          stroke: "#000000",
          fill: null,
          strokeWidth: 1,
          radius: 0,
          futureLayerField: "keep me",
        },
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
      "extra/notes.txt": [
        strToU8("An entry this version does not know. It must survive a save.\n"),
        6,
      ],
    },
    assets: [assetName],
    extraEntries: ["extra/notes.txt"],
  });
}
{
  const source = { width: 64, height: 48 };
  const image = stripes(source.width, source.height);
  const redaction = (id, mode, rect, strength, extra = {}) => ({
    id,
    ...common,
    type: "redaction",
    mode,
    rect,
    strength,
    seed: 99,
    ...extra,
  });
  fixtures.push({
    name: "v2-groups",
    manifest: manifest("00000000-0000-4000-8000-000000000005", source, image, {
      formatVersion: 2,
      minReaderVersion: 2,
    }),
    project: {
      version: 2,
      crop: { x: 2, y: 2, width: 60, height: 44 },
      layers: [
        {
          id: "r1",
          ...common,
          type: "rect",
          x: 4,
          y: 4,
          width: 20,
          height: 10,
          rotation: 0,
          stroke: "#000000",
          fill: null,
          strokeWidth: 1,
          radius: 0,
        },
        {
          id: "g1",
          ...common,
          type: "group",
          name: "Callout",
          futureGroupField: { keep: "me" },
          layers: [
            {
              id: "a1",
              ...common,
              type: "arrow",
              from: { x: 6, y: 30 },
              to: { x: 30, y: 20 },
              style: "straight",
              color: "#EF4444",
              width: 2,
            },
            {
              id: "g2",
              ...common,
              type: "group",
              layers: [
                {
                  id: "t1",
                  ...common,
                  type: "text",
                  x: 8,
                  y: 32,
                  width: null,
                  text: "Inside two groups",
                  fontId: "inter",
                  size: 8,
                  weight: 500,
                  color: "#111111",
                  background: null,
                  align: "left",
                  rotation: 0,
                },
                redaction("x1", "pixelate", { x: 34, y: 8, width: 20, height: 12 }, 4),
              ],
            },
          ],
        },
        {
          id: "g3",
          visible: false,
          locked: false,
          type: "group",
          name: "Hidden",
          layers: [
            redaction("x2", "solid", { x: 4, y: 20, width: 16, height: 8 }, 0, {
              color: "#000000",
            }),
          ],
        },
        {
          id: "g4",
          visible: true,
          locked: true,
          type: "group",
          layers: [
            {
              id: "c1",
              ...common,
              type: "counter",
              x: 50,
              y: 36,
              value: 1,
              color: "#EF4444",
              size: 10,
            },
          ],
        },
      ],
      presentation: presentation(),
    },
    entries: { "source.png": [image, 0], "preview.png": [image, 0] },
    assets: [],
    extraEntries: [],
  });
}

const v3 = { formatVersion: 3, minReaderVersion: 3 };
{
  const source = { width: 80, height: 50 };
  const image = gradient(source.width, source.height);
  fixtures.push({
    name: "v3-presentation",
    manifest: manifest("00000000-0000-4000-8000-000000000006", source, image, v3),
    project: {
      version: 3,
      crop: { x: 4, y: 2, width: 72, height: 46 },
      layers: [
        {
          id: "r1",
          ...common,
          type: "rect",
          x: 8,
          y: 8,
          width: 30,
          height: 16,
          rotation: 0,
          stroke: "#FFFFFF",
          fill: null,
          strokeWidth: 2,
          radius: 2,
        },
      ],
      presentation: presentation({
        enabled: true,
        background: {
          type: "mesh",
          seed: 4242,
          colors: ["#0F172A", "#1D4ED8", "#C8FF2E", "#F97316"],
          smoothness: 0.6,
          points: [
            [0, 0],
            [1, 0.1],
            [0.2, 1],
            [0.9, 0.9],
          ],
        },
        padding: { top: 20, right: 58, bottom: 28, left: 40 },
        autoBalance: false,
        cornerRadius: 10,
        shadow: { enabled: true, x: 2, y: 12, blur: 30, spread: -4, color: "#00000055" },
        frame: { type: "terminal", title: "zsh", theme: "dark" },
        aspect: { mode: "fixed", ratio: [9, 16], size: [1080, 1920], preset: "instagram-story" },
        exportScale: 1,
      }),
    },
    entries: { "source.png": [image, 0], "preview.png": [image, 0] },
    assets: [],
    extraEntries: [],
  });
}
{
  const source = { width: 60, height: 40 };
  const image = stripes(source.width, source.height);
  fixtures.push({
    name: "v3-source-blur",
    manifest: manifest("00000000-0000-4000-8000-000000000007", source, image, v3),
    project: {
      version: 3,
      crop: null,
      layers: [],
      presentation: presentation({
        enabled: true,
        background: { type: "source-blur", blur: 40, zoom: 1.3, dim: 0.1, saturation: 1.1 },
        frame: { type: "browser", title: "Checkout", url: "lumengrab.app/checkout", theme: "dark" },
        aspect: { mode: "fixed", ratio: [1.91, 1], size: [1200, 628], preset: "linkedin-link" },
        exportScale: 2,
      }),
    },
    entries: { "source.png": [image, 0], "preview.png": [image, 0] },
    assets: [],
    extraEntries: [],
  });
}
{
  const source = { width: 60, height: 40 };
  const image = gradient(source.width, source.height);
  const asset = stripes(16, 16);
  const assetName = `${sha256(asset)}.png`;
  fixtures.push({
    name: "v3-image-background",
    manifest: manifest("00000000-0000-4000-8000-000000000008", source, image, v3),
    project: {
      version: 3,
      crop: null,
      layers: [],
      presentation: presentation({
        enabled: true,
        background: { type: "image", asset: assetName, fit: "contain", blur: 6, dim: 0.2 },
        frame: { type: "minimal" },
        futurePresentationField: ["keep", "me"],
      }),
    },
    entries: {
      "source.png": [image, 0],
      "preview.png": [image, 0],
      [`assets/${assetName}`]: [asset, 0],
    },
    assets: [assetName],
    extraEntries: [],
  });
}
{
  const source = { width: 60, height: 40 };
  const image = gradient(source.width, source.height);
  fixtures.push({
    name: "v3-radial-gradient",
    manifest: manifest("00000000-0000-4000-8000-000000000009", source, image, v3),
    project: {
      version: 3,
      crop: null,
      layers: [],
      presentation: presentation({
        enabled: true,
        background: {
          type: "gradient",
          kind: "radial",
          angle: 0,
          stops: [
            { offset: 0, color: "#84CC16" },
            { offset: 0.6, color: "#84CC1699" },
            { offset: 1, color: "#052E16" },
          ],
        },
        frame: { type: "windows-window", title: "Fixture", theme: "light" },
      }),
    },
    entries: { "source.png": [image, 0], "preview.png": [image, 0] },
    assets: [],
    extraEntries: [],
  });
}

const v4 = { formatVersion: 4, minReaderVersion: 4 };
const fixtureCode = `// @param float speed = 1.0 [0.0, 4.0]
// @param color tint = #C8FF2E
// @param bool soft = true
precision mediump float;
uniform vec2 u_resolution;
uniform float u_phase;
uniform vec3 u_palette[8];
uniform float speed;
uniform vec3 tint;
uniform bool soft;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_phase * 6.28318 * floor(speed + 0.5);
  float w = sin(uv.x * 8.0 + t) * 0.5 + 0.5;
  vec3 base = mix(u_palette[0], u_palette[1], uv.y);
  gl_FragColor = vec4(mix(base, tint, w * (soft ? uv.y : 1.0)), 1.0);
}
`;
{
  const source = { width: 80, height: 50 };
  const image = gradient(source.width, source.height);
  const shaderLayer = (id, kind, extra) => ({
    id,
    kind,
    enabled: true,
    opacity: 1,
    blend: "normal",
    speed: 1,
    params: {},
    ...extra,
  });
  fixtures.push({
    name: "v4-shader",
    manifest: manifest("00000000-0000-4000-8000-00000000000a", source, image, v4),
    project: {
      version: 4,
      crop: null,
      layers: [],
      presentation: presentation({
        enabled: true,
        background: {
          type: "shader",
          engine: 1,
          loop: 8,
          poster: 2.5,
          seed: 48213,
          palette: ["#2DD4BF", "#0EA5E9", "#84CC16", "#C8FF2E", "#0B3A5C", "#050A14"],
          fallback: "#050A14",
          futureShaderField: { keep: "me" },
          layers: [
            shaderLayer("g1", "gradient", {
              params: {
                type: "linear",
                angle: 150,
                stops: [
                  { offset: 0, color: "#050A14" },
                  { offset: 0.55, color: "#84CC16" },
                  { offset: 1, color: "#0B3A5C" },
                ],
              },
            }),
            shaderLayer("a1", "aurora", {
              opacity: 0.9,
              blend: "screen",
              speed: 2,
              reverse: true,
              seed: 777,
              params: {
                scale: 1.2,
                rotation: 35,
                offsetX: 0.1,
                offsetY: -0.05,
                source: "custom",
                highlight: "#C8FF2E",
              },
            }),
            shaderLayer("o1", "orbs", {
              enabled: false,
              opacity: 0.7,
              blend: "overlay",
              params: { count: 5, size: 0.5, softness: 0.6, spread: 0.5, source: "palette" },
            }),
            shaderLayer("c1", "custom", {
              name: "Glow",
              role: "generator",
              opacity: 0.85,
              blend: "soft-light",
              speed: 0,
              code: fixtureCode,
              params: { speed: 1, tint: "#C8FF2E", soft: true },
            }),
            shaderLayer("f1", "grain", {
              opacity: 0.3,
              blend: "overlay",
              params: { amount: 0.3, size: 1.2, animate: true },
            }),
            shaderLayer("u1", "kind-from-the-future", {
              blend: "multiply",
              speed: 0,
              params: { power: 3, label: "keep", list: [1, 2, 3] },
              futureLayerField: ["keep", "me"],
            }),
          ],
        },
        frame: { type: "macos-window", title: "Fixture" },
      }),
    },
    entries: { "source.png": [image, 0], "preview.png": [image, 0] },
    assets: [],
    extraEntries: [],
  });
}
{
  const source = { width: 60, height: 40 };
  const image = gradient(source.width, source.height);
  const frozen = stripes(24, 14);
  const frozenName = `${sha256(frozen)}.png`;
  fixtures.push({
    name: "v4-frozen-frame",
    manifest: manifest("00000000-0000-4000-8000-00000000000b", source, image, v4),
    project: {
      version: 4,
      crop: null,
      layers: [],
      presentation: presentation({
        enabled: true,
        background: { type: "image", asset: frozenName, fit: "cover" },
        aspect: { mode: "fixed", ratio: [16, 9] },
      }),
    },
    entries: {
      "source.png": [image, 0],
      "preview.png": [image, 0],
      [`assets/${frozenName}`]: [frozen, 0],
    },
    assets: [frozenName],
    extraEntries: [],
  });
}

for (const fixture of fixtures) {
  const target = join(OUT, `${fixture.name}.lumengrab`);
  const expected = join(OUT, `${fixture.name}.expected.json`);
  if (existsSync(target) || existsSync(expected)) {
    console.log(`${fixture.name}: already exists, kept (golden fixtures are never overwritten)`);
    continue;
  }
  const files = {
    "manifest.json": [
      strToU8(`${JSON.stringify(fixture.manifest, null, 2)}\n`),
      { level: 6, mtime: Date.UTC(2026, 0, 1) },
    ],
    "project.json": [
      strToU8(`${JSON.stringify(fixture.project, null, 2)}\n`),
      { level: 6, mtime: Date.UTC(2026, 0, 1) },
    ],
  };
  for (const [name, [data, level]] of Object.entries(fixture.entries))
    files[name] = [data, { level, mtime: Date.UTC(2026, 0, 1) }];
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
