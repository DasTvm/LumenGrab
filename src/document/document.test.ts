import { strFromU8, strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { DocumentError, type DocumentErrorCode } from "./errors";
import { sha256Hex } from "./hash";
import { FORMAT_VERSION, LIMITS } from "./limits";
import { openDocument } from "./read";
import { goodManifest, goodProject, rawFile, SOURCE_PNG } from "./testing/build";
import { encodePng, stripes } from "./testing/png";
import { createDocument, defaultProject, serializeDocument } from "./write";

const NOW = new Date("2026-10-06T12:30:00Z");

async function expectError(bytes: Uint8Array, code: DocumentErrorCode, detail?: string | RegExp) {
  try {
    await openDocument(bytes);
  } catch (e) {
    expect(e).toBeInstanceOf(DocumentError);
    const error = e as DocumentError;
    expect(error.code).toBe(code);
    if (typeof detail === "string") expect(error.detail).toBe(detail);
    else if (detail) expect(error.detail).toMatch(detail);
    expect(error.userMessage.length).toBeGreaterThan(10);
    return;
  }
  throw new Error(`expected a DocumentError (${code})`);
}

describe("create, save, open", () => {
  it("round-trips a new document and keeps the original picture byte for byte", async () => {
    const png = encodePng(stripes(40, 30));
    const doc = await createDocument(png, {
      scale: 2,
      now: NOW,
      documentId: "doc-1",
      createdBy: "LumenGrab 0.1.0",
    });
    expect(doc.manifest.source).toMatchObject({
      width: 40,
      height: 30,
      scale: 2,
      sha256: await sha256Hex(png),
    });
    expect(doc.project).toEqual(defaultProject());

    const preview = encodePng(stripes(20, 15));
    const bytes = serializeDocument(doc, preview, { now: new Date("2026-10-06T12:45:00Z") });
    const opened = await openDocument(bytes);

    expect(opened.warnings).toEqual([]);
    expect(opened.readOnly).toBeNull();
    expect(opened.doc.source).toEqual(png); // never modified
    expect(opened.doc.preview).toEqual(preview);
    expect(opened.doc.project).toEqual(doc.project);
    expect(opened.doc.manifest).toEqual({
      ...doc.manifest,
      createdAt: "2026-10-06T12:30:00Z",
      modifiedAt: "2026-10-06T12:45:00Z",
    });
  });

  it("writes the same bytes for the same document", async () => {
    const doc = await createDocument(SOURCE_PNG, { now: NOW, documentId: "doc-1" });
    expect(serializeDocument(doc, SOURCE_PNG, { now: NOW })).toEqual(
      serializeDocument(doc, SOURCE_PNG, { now: NOW }),
    );
  });

  it("keeps unknown fields, unknown layer types, assets and unknown entries through a save", async () => {
    const asset = encodePng(stripes(6, 6));
    const assetName = `${await sha256Hex(asset)}.png`;
    const project = goodProject();
    project["futureProjectField"] = { list: [1, 2, 3] };
    (project["layers"] as unknown[]).push(
      { id: "s1", type: "stamp", visible: true, locked: false, sparkle: 11 },
      {
        id: "r1",
        type: "rect",
        visible: true,
        locked: false,
        x: 1,
        y: 2,
        width: 3,
        height: 4,
        rotation: 0,
        stroke: "#000000",
        fill: null,
        strokeWidth: 1,
        radius: 0,
        hint: "keep me",
      },
    );
    (project["presentation"] as Record<string, unknown>)["background"] = {
      type: "image",
      asset: assetName,
      fit: "cover",
      tint: "#FF0000",
    };
    const manifest = { ...(await goodManifest()), futureManifestField: "x" };
    const first = await openDocument(
      await rawFile({
        manifest,
        project,
        entries: {
          [`assets/${assetName}`]: asset,
          "extra/notes.txt": strToU8("a note from the future"),
        },
      }),
    );
    expect(first.warnings).toEqual([]);

    const saved = serializeDocument(first.doc, SOURCE_PNG, { now: NOW });
    const second = await openDocument(saved);

    expect(second.doc.manifest).toMatchObject({ futureManifestField: "x" });
    expect(second.doc.project).toMatchObject({ futureProjectField: { list: [1, 2, 3] } });
    expect(second.doc.project?.layers).toEqual(first.doc.project?.layers);
    expect(second.doc.project?.layers[0]).toMatchObject({ type: "stamp", sparkle: 11 });
    expect(second.doc.project?.layers[1]).toMatchObject({ hint: "keep me" });
    expect(second.doc.project?.presentation.background).toMatchObject({ tint: "#FF0000" });
    expect(second.doc.assets[assetName]).toEqual(asset);
    expect(strFromU8(second.doc.extraEntries["extra/notes.txt"] ?? new Uint8Array())).toBe(
      "a note from the future",
    );
  });

  it("refuses to save a document that was opened read-only", async () => {
    const opened = await openDocument(
      await rawFile({
        manifest: { ...(await goodManifest()), formatVersion: 9, minReaderVersion: 9 },
        project: { version: 9, strange: true },
      }),
    );
    expect(() => serializeDocument(opened.doc, SOURCE_PNG)).toThrow(/read-only/);
  });

  it("marks a file written by an older version as upgraded: formatVersion and minReaderVersion follow the app", async () => {
    const opened = await openDocument(await rawFile());
    const older = { ...opened.doc, manifest: { ...opened.doc.manifest, formatVersion: 0 } };
    const reopened = await openDocument(serializeDocument(older, SOURCE_PNG));
    expect(reopened.doc.manifest.formatVersion).toBe(FORMAT_VERSION);
    expect(reopened.doc.manifest.minReaderVersion).toBe(FORMAT_VERSION);
  });
});

describe("versions", () => {
  it("opens a file with a higher minReaderVersion read-only, with the numbers for the dialog", async () => {
    const opened = await openDocument(
      await rawFile({
        manifest: { ...(await goodManifest()), formatVersion: 4, minReaderVersion: 4 },
        project: { version: 4, somethingNew: { a: 1 } }, // does not fit this version's schema
      }),
    );
    expect(opened.readOnly).toEqual({
      reason: "newer-version",
      fileVersion: 4,
      minReaderVersion: 4,
      supportedVersion: FORMAT_VERSION,
    });
    expect(opened.doc.project).toBeNull();
    expect(opened.doc.preview).not.toBeNull(); // enough to view it
    expect(opened.doc.source).toEqual(SOURCE_PNG);
  });

  it("still gives the project of a read-only file when it happens to fit", async () => {
    const opened = await openDocument(
      await rawFile({
        manifest: { ...(await goodManifest()), formatVersion: 2, minReaderVersion: 2 },
        project: { ...goodProject(), version: 2 },
      }),
    );
    expect(opened.readOnly).not.toBeNull();
    expect(opened.doc.project?.version).toBe(2);
  });

  it("opens a newer formatVersion with an old minReaderVersion for editing and keeps its unknown parts", async () => {
    const project = { ...goodProject(), version: 2, addedLater: { keep: true } };
    const opened = await openDocument(
      await rawFile({
        manifest: { ...(await goodManifest()), formatVersion: 2, minReaderVersion: 1 },
        project,
      }),
    );
    expect(opened.readOnly).toBeNull();
    expect(opened.doc.project).toMatchObject({ version: 2, addedLater: { keep: true } });
    const saved = await openDocument(serializeDocument(opened.doc, SOURCE_PNG));
    expect(saved.doc.project).toMatchObject({ version: 2, addedLater: { keep: true } });
    expect(saved.doc.manifest).toMatchObject({ formatVersion: 2, minReaderVersion: 1 });
  });
});

describe("damaged and hostile files", () => {
  it("rejects each required entry that is missing", async () => {
    for (const name of ["manifest.json", "project.json", "source.png"]) {
      await expectError(
        await rawFile({ entries: { [name]: null } }),
        "missing-entry",
        `${name} is missing`,
      );
    }
  });

  it("rejects JSON that is not JSON, or not an object", async () => {
    await expectError(
      await rawFile({ entries: { "manifest.json": strToU8("{ nope") } }),
      "bad-json",
      "manifest.json: not valid JSON",
    );
    await expectError(
      await rawFile({ entries: { "project.json": strToU8("[1,2]") } }),
      "bad-json",
      "project.json: not a JSON object",
    );
  });

  it("rejects a file that is not a LumenGrab file", async () => {
    await expectError(
      await rawFile({ manifest: { ...(await goodManifest()), format: "something-else" } }),
      "wrong-format",
    );
    await expectError(await rawFile({ manifest: { hello: "world" } }), "wrong-format");
  });

  it("names the missing or invalid field in the dialog's one-line detail", async () => {
    const noLayers = Object.fromEntries(
      Object.entries(goodProject()).filter(([key]) => key !== "layers"),
    );
    await expectError(
      await rawFile({ project: noLayers }),
      "invalid-field",
      "project.json: invalid or missing field “layers”",
    );
    const badLayer = {
      ...goodProject(),
      layers: [
        {
          id: "x",
          type: "rect",
          visible: true,
          locked: false,
          x: 1,
          y: 2,
          width: "wide",
          height: 4,
          rotation: 0,
          stroke: null,
          fill: null,
          strokeWidth: 1,
          radius: 0,
        },
      ],
    };
    await expectError(
      await rawFile({ project: badLayer }),
      "invalid-field",
      /project\.json: invalid or missing field “layers\.0\.width”/,
    );
    await expectError(
      await rawFile({ project: { ...goodProject(), version: "one" } }),
      "invalid-field",
      /version/,
    );
    const manifest = await goodManifest();
    await expectError(
      await rawFile({
        manifest: { ...manifest, source: { ...(manifest["source"] as object), sha256: "xyz" } },
      }),
      "invalid-field",
      /manifest\.json: invalid or missing field “source\.sha256”/,
    );
  });

  it("rejects a project with a non-finite coordinate", async () => {
    const text = JSON.stringify({
      ...goodProject(),
      layers: [
        {
          id: "c",
          type: "counter",
          visible: true,
          locked: false,
          x: "X",
          y: 0,
          value: 1,
          color: "#000000",
          size: 10,
        },
      ],
    }).replace('"X"', "1e999");
    await expectError(
      await rawFile({ entries: { "project.json": strToU8(text) } }),
      "invalid-field",
      /layers\.0\.x/,
    );
  });

  it("clamps an absurd but finite coordinate instead of failing", async () => {
    const project = {
      ...goodProject(),
      layers: [
        {
          id: "c",
          type: "counter",
          visible: true,
          locked: false,
          x: 1e300,
          y: -5,
          value: 1,
          color: "#000000",
          size: 10,
        },
      ],
    };
    const opened = await openDocument(await rawFile({ project }));
    expect(opened.doc.project?.layers[0]).toMatchObject({ x: 1e6, y: -5 });
  });

  it("rejects more layers than the limit", async () => {
    const layer = {
      id: "c",
      type: "counter",
      visible: true,
      locked: false,
      x: 1,
      y: 1,
      value: 1,
      color: "#000000",
      size: 10,
    };
    const project = {
      ...goodProject(),
      layers: Array.from({ length: LIMITS.maxLayers + 1 }, (_, i) => ({
        ...layer,
        id: `c${String(i)}`,
      })),
    };
    await expectError(await rawFile({ project }), "too-large", /layers/);
  });

  it("rejects an oversized picture from its header, before decoding anything", async () => {
    const huge = new Uint8Array(SOURCE_PNG);
    new DataView(huge.buffer).setUint32(16, 20000); // width in IHDR
    await expectError(
      await rawFile({ entries: { "source.png": huge } }),
      "image-too-large",
      /20000/,
    );
  });

  it("rejects a source that is not a PNG", async () => {
    await expectError(
      await rawFile({
        entries: {
          "source.png": strToU8(
            "GIF89a not a png at all, long enough to pass the length check.......",
          ),
        },
      }),
      "bad-image",
    );
  });

  it("rejects an oversized JSON entry", async () => {
    const big = strToU8(
      JSON.stringify({ ...goodProject(), filler: "x".repeat(LIMITS.maxJsonBytes) }),
    );
    await expectError(
      await rawFile({ entries: { "project.json": big } }),
      "too-large",
      /project\.json/,
    );
  });

  it("rejects zip-slip names and a truncated file", async () => {
    await expectError(
      await rawFile({ entries: { "../evil.txt": strToU8("x") } }),
      "bad-entry-name",
    );
    const good = await rawFile();
    await expectError(good.subarray(0, Math.floor(good.length / 2)), "not-a-zip");
  });

  it("rejects a ZIP with entries that appear in the local headers but not in the directory", async () => {
    const bytes = new Uint8Array(await rawFile());
    // Make the end record claim one entry fewer than the file really holds.
    const view = new DataView(bytes.buffer);
    for (let at = bytes.length - 22; at >= 0; at -= 1) {
      if (view.getUint32(at, true) === 0x06054b50) {
        view.setUint16(at + 10, view.getUint16(at + 10, true) - 1, true);
        break;
      }
    }
    await expectError(bytes, "not-a-zip", /directory/);
  });
});

describe("warnings: the file still opens", () => {
  const codes = (w: { code: string }[]) => w.map((x) => x.code);

  it("warns when the picture does not match its checksum", async () => {
    const manifest = await goodManifest();
    const wrong = {
      ...manifest,
      source: { ...(manifest["source"] as object), sha256: "0".repeat(64) },
    };
    const opened = await openDocument(await rawFile({ manifest: wrong }));
    expect(codes(opened.warnings)).toEqual(["source-hash"]);
    expect(opened.doc.project).not.toBeNull();
  });

  it("warns when the picture size differs from the manifest", async () => {
    const manifest = await goodManifest();
    const wrong = { ...manifest, source: { ...(manifest["source"] as object), width: 99 } };
    expect(codes((await openDocument(await rawFile({ manifest: wrong }))).warnings)).toEqual([
      "source-size",
    ]);
  });

  it("warns about a missing background asset and about a missing preview", async () => {
    const project = goodProject();
    (project["presentation"] as Record<string, unknown>)["background"] = {
      type: "image",
      asset: `${"a".repeat(64)}.png`,
      fit: "cover",
    };
    const opened = await openDocument(await rawFile({ project, entries: { "preview.png": null } }));
    expect(codes(opened.warnings).sort()).toEqual(["missing-asset", "missing-preview"]);
  });

  it("warns when an asset does not match the hash in its name", async () => {
    const opened = await openDocument(
      await rawFile({ entries: { [`assets/${"b".repeat(64)}.png`]: encodePng(stripes(4, 4)) } }),
    );
    expect(codes(opened.warnings)).toEqual(["asset-hash"]);
  });

  it("warns once per unknown font", async () => {
    const text = {
      id: "t",
      type: "text",
      visible: true,
      locked: false,
      x: 0,
      y: 0,
      width: null,
      text: "hi",
      fontId: "comic-sans",
      size: 12,
      weight: 400,
      color: "#000000",
      background: null,
      align: "left",
      rotation: 0,
    };
    const project = {
      ...goodProject(),
      layers: [text, { ...text, id: "t2" }, { ...text, id: "t3", fontId: "inter" }],
    };
    const opened = await openDocument(await rawFile({ project }));
    expect(opened.warnings).toHaveLength(1);
    expect(opened.warnings[0]).toMatchObject({ code: "unknown-font" });
    expect(opened.warnings[0]?.message).toContain("comic-sans");
  });

  it("does not trust an asset name that tries to leave the assets folder", async () => {
    const project = goodProject();
    (project["presentation"] as Record<string, unknown>)["background"] = {
      type: "image",
      asset: "../../etc/passwd",
      fit: "cover",
    };
    expect(codes((await openDocument(await rawFile({ project }))).warnings)).toEqual([
      "missing-asset",
    ]);
  });
});

describe("a file from another writer", () => {
  it("reads a ZIP made by a generic tool (deflated PNG, folder entries, comment)", async () => {
    const zip = zipSync(
      {
        "assets/": new Uint8Array(0),
        "manifest.json": strToU8(JSON.stringify(await goodManifest())),
        "project.json": strToU8(JSON.stringify(goodProject())),
        "source.png": [SOURCE_PNG, { level: 9 }],
        "preview.png": SOURCE_PNG,
      },
      { comment: undefined },
    );
    const opened = await openDocument(zip);
    expect(opened.warnings).toEqual([]);
    expect(opened.doc.source).toEqual(SOURCE_PNG);
  });
});
