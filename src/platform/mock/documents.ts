import { strToU8 } from "fflate";
import { writeContainer, type ContainerEntry } from "../../document/container";
import { sha256Hex } from "../../document/hash";
import { renderPreview } from "../../document/render/flatten";
import { editorCodec } from "../../editor/draw/codec";
import type { Layer, Redaction } from "../../document/schema";
import { createDocument, defaultProject, serializeDocument } from "../../document/write";
import sampleCaptureUrl from "./sample-capture.png?url";

/**
 * Documents for the browser mock, built with the real library (`?scenario=ready|redactions|annotated|stack|systemfont|
 * readonly|corrupt|truncated|warnings`), so the viewer window can be developed and tested without the app.
 */

const NOW = new Date("2026-10-09T14:02:00Z");

async function sampleCapture(): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(sampleCaptureUrl)).arrayBuffer());
}

const redaction = (id: string, mode: Redaction["mode"], x: number, y: number): Redaction => ({
  id,
  type: "redaction",
  visible: true,
  locked: false,
  mode,
  rect: { x, y, width: 360, height: 120 },
  strength: 12,
  ...(mode === "solid" ? { color: "#18181B" } : {}),
  seed: 2024,
});

const base = { visible: true, locked: false };

/** A realistic stack for the layers panel: a group with a callout, a counter, a redaction and a locked frame. */
const LAYER_STACK: Layer[] = [
  {
    id: "frame",
    ...base,
    locked: true,
    type: "rect",
    name: "Frame",
    x: 40,
    y: 40,
    width: 1360,
    height: 820,
    rotation: 0,
    stroke: "#18181B",
    fill: null,
    strokeWidth: 2,
    radius: 0,
  },
  {
    id: "callout",
    ...base,
    type: "group",
    name: "Total callout",
    layers: [
      {
        id: "box",
        ...base,
        type: "rect",
        x: 700,
        y: 420,
        width: 400,
        height: 120,
        rotation: 0,
        stroke: "#EF4444",
        fill: null,
        strokeWidth: 6,
        radius: 12,
      },
      {
        id: "pointer",
        ...base,
        type: "arrow",
        from: { x: 560, y: 700 },
        to: { x: 720, y: 560 },
        style: "curved",
        color: "#EF4444",
        width: 6,
      },
      {
        id: "note",
        ...base,
        type: "text",
        x: 380,
        y: 700,
        width: null,
        text: "Wrong total?",
        fontId: "inter",
        size: 36,
        weight: 600,
        color: "#EF4444",
        background: null,
        align: "left",
        rotation: 0,
      },
    ],
  },
  { ...redaction("mask", "pixelate", 120, 300), strength: 14 },
  {
    id: "one",
    ...base,
    type: "counter",
    x: 90,
    y: 250,
    value: 1,
    color: "#EF4444",
    size: 48,
  },
];

/** Text in a font that is installed on the device that made the file (`system:` id). */
const SYSTEM_FONT_TEXT: Layer[] = [
  {
    id: "avenir",
    ...base,
    type: "text",
    x: 200,
    y: 200,
    width: null,
    text: "Set in Avenir Next",
    fontId: "system:Avenir Next",
    size: 48,
    weight: 500,
    color: "#18181B",
    background: null,
    align: "left",
    rotation: 0,
  },
];

async function newDocument(layers: Redaction[] | "annotation" | "stack" | "systemfont" = []) {
  const png = await sampleCapture();
  const doc = await createDocument(png, { scale: 2, now: NOW, createdBy: "LumenGrab 0.1.0" });
  if (!doc.project) throw new Error("a new document has a project");
  if (layers === "systemfont") {
    doc.project.layers.push(...structuredClone(SYSTEM_FONT_TEXT));
  } else if (layers === "stack") {
    doc.project.layers.push(...structuredClone(LAYER_STACK));
  } else if (layers === "annotation") {
    doc.project.layers.push({
      id: "a1",
      type: "rect",
      visible: true,
      locked: false,
      x: 200,
      y: 160,
      width: 400,
      height: 200,
      rotation: 0,
      stroke: "#EF4444",
      fill: null,
      strokeWidth: 6,
      radius: 8,
    });
  } else {
    doc.project.layers.push(...layers);
  }
  return doc;
}

async function save(doc: Awaited<ReturnType<typeof newDocument>>): Promise<Uint8Array> {
  return serializeDocument(doc, await renderPreview(doc, editorCodec), { now: NOW });
}

const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);

async function entriesOf(
  manifestOverrides: Record<string, unknown>,
  project: unknown,
  extra: ContainerEntry[] = [],
): Promise<Uint8Array> {
  const doc = await newDocument();
  const preview = await renderPreview(doc, editorCodec);
  return writeContainer([
    {
      name: "manifest.json",
      data: json({ ...doc.manifest, ...manifestOverrides }),
      compress: true,
    },
    { name: "project.json", data: json(project), compress: true },
    { name: "source.png", data: doc.source, compress: false },
    { name: "preview.png", data: preview, compress: false },
    ...extra,
  ]);
}

/** A 600 x 300 white picture whose content (a dark window) sits left and high: 40 px empty above and on the left, 260 px on the right, 80 below. */
async function marginsDocument() {
  const canvas = new OffscreenCanvas(600, 300);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 600, 300);
  ctx.fillStyle = "#1e293b";
  ctx.fillRect(40, 40, 300, 180);
  ctx.fillStyle = "#c8ff2e";
  ctx.fillRect(60, 60, 120, 20);
  const png = new Uint8Array(
    await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
  );
  return createDocument(png, { scale: 1, now: NOW, createdBy: "LumenGrab 0.1.0" });
}

export async function buildScenario(scenario: string): Promise<Uint8Array> {
  switch (scenario) {
    case "margins":
      return save(await marginsDocument());
    case "redactions":
      return save(
        await newDocument([redaction("r1", "solid", 120, 120), redaction("r2", "blur", 120, 300)]),
      );
    case "stack":
      return save(await newDocument("stack"));
    case "systemfont":
      return save(await newDocument("systemfont"));
    case "annotated":
      return save(await newDocument("annotation"));
    case "readonly":
      // From a version of the format that does not exist yet: it does not fit our schema at all.
      return entriesOf(
        { formatVersion: 4, minReaderVersion: 4 },
        { version: 4, crop: null, scene: { nodes: [] } },
      );
    case "corrupt": {
      // The project lost its layers: the example of the design.
      const broken = Object.fromEntries(
        Object.entries(defaultProject()).filter(([key]) => key !== "layers"),
      );
      return entriesOf({}, broken);
    }
    case "truncated": {
      const good = await save(await newDocument());
      return good.subarray(0, Math.floor(good.length / 2));
    }
    case "warnings": {
      const project = defaultProject();
      project.presentation.background = {
        type: "image",
        asset: `${"a".repeat(64)}.png`,
        fit: "cover",
      };
      const doc = await newDocument();
      return entriesOf(
        { source: { ...doc.manifest.source, sha256: await sha256Hex(strToU8("other")) } },
        project,
      );
    }
    default:
      return save(await newDocument());
  }
}
