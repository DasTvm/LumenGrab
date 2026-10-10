import { strToU8 } from "fflate";
import { writeContainer, type ContainerEntry } from "../../document/container";
import { sha256Hex } from "../../document/hash";
import { canvasCodec } from "../../document/render/canvas-codec";
import { renderPreview } from "../../document/render/flatten";
import type { Redaction } from "../../document/schema";
import { createDocument, defaultProject, serializeDocument } from "../../document/write";
import sampleCaptureUrl from "./sample-capture.png?url";

/**
 * Documents for the browser mock, built with the real library (`?scenario=ready|redactions|annotated|
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

async function newDocument(layers: Redaction[] | "annotation" = []) {
  const png = await sampleCapture();
  const doc = await createDocument(png, { scale: 2, now: NOW, createdBy: "LumenGrab 0.1.0" });
  if (!doc.project) throw new Error("a new document has a project");
  if (layers === "annotation") {
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
  return serializeDocument(doc, await renderPreview(doc, canvasCodec), { now: NOW });
}

const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);

async function entriesOf(
  manifestOverrides: Record<string, unknown>,
  project: unknown,
  extra: ContainerEntry[] = [],
): Promise<Uint8Array> {
  const doc = await newDocument();
  const preview = await renderPreview(doc, canvasCodec);
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

export async function buildScenario(scenario: string): Promise<Uint8Array> {
  switch (scenario) {
    case "redactions":
      return save(
        await newDocument([redaction("r1", "solid", 120, 120), redaction("r2", "blur", 120, 300)]),
      );
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
