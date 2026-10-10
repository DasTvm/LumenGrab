import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FORMAT_VERSION } from "./limits";
import { openDocument } from "./read";
import { serializeDocument } from "./write";

/**
 * Golden fixtures (docs/FORMAT.md section 5): every file ever released must keep opening. Each
 * `vN-*.lumengrab` is paired with a hand-written `.expected.json`. These files are never edited; a
 * failing test here means the reader broke, not the fixture.
 */

const DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "fixtures", "lumengrab");
const names = readdirSync(DIR)
  .filter((f) => f.endsWith(".lumengrab"))
  .map((f) => f.slice(0, -".lumengrab".length))
  .sort();

interface Expected {
  manifest: Record<string, unknown>;
  project: Record<string, unknown>;
  assets: string[];
  extraEntries: string[];
  warnings: string[];
  readOnly: unknown;
}

const load = (name: string) => ({
  bytes: new Uint8Array(readFileSync(join(DIR, `${name}.lumengrab`))),
  expected: JSON.parse(readFileSync(join(DIR, `${name}.expected.json`), "utf8")) as Expected,
});

describe("golden fixtures", () => {
  it("has at least one fixture for every format version up to the current one", () => {
    for (let version = 1; version <= FORMAT_VERSION; version += 1) {
      expect(
        names.some((n) => n.startsWith(`v${String(version)}-`)),
        `a fixture for v${String(version)}`,
      ).toBe(true);
    }
  });

  it("names every fixture vN-* and gives each an expected file", () => {
    expect(names.length).toBeGreaterThanOrEqual(4);
    for (const name of names) {
      expect(name).toMatch(/^v\d+-[a-z0-9-]+$/);
      expect(existsSync(join(DIR, `${name}.expected.json`)), `${name}.expected.json`).toBe(true);
    }
  });

  describe.each(names)("%s", (name) => {
    it("opens, migrates to the latest version, validates, and equals what a correct reader must produce", async () => {
      const { bytes, expected } = load(name);
      const opened = await openDocument(bytes);

      expect(opened.doc.manifest).toEqual(expected.manifest);
      expect(opened.doc.project).toEqual(expected.project);
      expect(opened.doc.project?.version).toBeGreaterThanOrEqual(FORMAT_VERSION);
      expect(Object.keys(opened.doc.assets).sort()).toEqual(expected.assets);
      expect(Object.keys(opened.doc.extraEntries).sort()).toEqual(expected.extraEntries);
      expect(opened.warnings.map((w) => w.code)).toEqual(expected.warnings);
      expect(opened.readOnly).toEqual(expected.readOnly);
      expect(opened.doc.preview).not.toBeNull();
    });

    it("survives open -> save -> open unchanged, including unknown fields and entries", async () => {
      const { bytes } = load(name);
      const first = await openDocument(bytes);
      const saved = serializeDocument(first.doc, first.doc.preview ?? first.doc.source, {
        now: new Date("2026-10-06T12:05:00Z"),
      });
      const second = await openDocument(saved);
      expect(second.doc.project).toEqual(first.doc.project);
      expect(second.doc.manifest).toEqual(first.doc.manifest);
      expect(second.doc.source).toEqual(first.doc.source);
      expect(second.doc.assets).toEqual(first.doc.assets);
      expect(second.doc.extraEntries).toEqual(first.doc.extraEntries);
      expect(second.warnings).toEqual(first.warnings);
    });
  });

  it("v1-unknown-fields really carries unknown data to the reader (the test above would pass vacuously otherwise)", async () => {
    const { bytes } = load("v1-unknown-fields");
    const { doc } = await openDocument(bytes);
    expect(doc.manifest).toMatchObject({ futureManifestField: { list: [1, 2, 3] } });
    expect(doc.project).toMatchObject({ futureProjectField: { keep: true } });
    expect(doc.project?.layers[0]).toMatchObject({ futureLayerField: "keep me" });
    expect(doc.project?.layers[1]).toMatchObject({ type: "stamp", shape: "star" });
    expect(Object.keys(doc.extraEntries)).toEqual(["extra/notes.txt"]);
  });

  it("v1-all-layers covers every layer type of the spec", async () => {
    const { doc } = await openDocument(load("v1-all-layers").bytes);
    const types = new Set(doc.project?.layers.map((l) => l.type));
    for (const type of [
      "arrow",
      "line",
      "rect",
      "ellipse",
      "text",
      "counter",
      "pencil",
      "highlighter",
      "spotlight",
      "redaction",
    ]) {
      expect(types.has(type), type).toBe(true);
    }
  });
});
