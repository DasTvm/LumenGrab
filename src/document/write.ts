import { strToU8 } from "fflate";
import { writeContainer, type ContainerEntry } from "./container";
import { sha256Hex } from "./hash";
import { FORMAT_VERSION } from "./limits";
import { readPngSize } from "./png";
import type { Manifest, Presentation, Project } from "./schema";
import type { DocumentFile } from "./types";

/** The `createdBy` of a file written without a version (tests); the app passes `LumenGrab <version>`. */
export const DEFAULT_CREATED_BY = "LumenGrab";

/** A neutral look for a fresh document (docs/FORMAT.md section 4). `enabled: false`: the screenshot is shown as it is. */
export function defaultPresentation(): Presentation {
  return {
    enabled: false,
    background: { type: "solid", color: "#F4F4F5" },
    padding: { top: 64, right: 64, bottom: 64, left: 64 },
    autoBalance: true,
    cornerRadius: 12,
    shadow: { enabled: true, x: 0, y: 20, blur: 50, spread: 0, color: "#00000040" },
    frame: { type: "none" },
    aspect: { mode: "free" },
    exportScale: 1,
  };
}

export function defaultProject(): Project {
  return { version: FORMAT_VERSION, crop: null, layers: [], presentation: defaultPresentation() };
}

export interface CreateOptions {
  /** Display scale of the capture (1, 2, ...). Informational. */
  scale?: number;
  now?: Date;
  documentId?: string;
  createdBy?: string;
}

const timestamp = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

/** A new document around a captured PNG. The picture is kept byte for byte. */
export async function createDocument(
  png: Uint8Array,
  options: CreateOptions = {},
): Promise<DocumentFile> {
  const { width, height } = readPngSize(png, "source.png");
  const now = timestamp(options.now ?? new Date());
  const manifest: Manifest = {
    format: "lumengrab",
    formatVersion: FORMAT_VERSION,
    minReaderVersion: FORMAT_VERSION,
    createdBy: options.createdBy ?? DEFAULT_CREATED_BY,
    createdAt: now,
    modifiedAt: now,
    documentId: options.documentId ?? crypto.randomUUID(),
    source: {
      file: "source.png",
      width,
      height,
      scale: options.scale ?? 1,
      sha256: await sha256Hex(png),
    },
  };
  return {
    manifest,
    project: defaultProject(),
    source: png,
    preview: null,
    assets: {},
    extraEntries: {},
  };
}

export interface SerializeOptions {
  now?: Date;
}

/**
 * The bytes of a `.lumengrab` file (docs/FORMAT.md section 6). `preview` is the rendered result
 * (`preview.png`). Unknown fields and unknown entries come back out exactly as they went in.
 *
 * A file upgraded from an older version is written with the app's version as `formatVersion` and
 * `minReaderVersion`: an old app cannot be trusted to read it.
 */
export function serializeDocument(
  doc: DocumentFile,
  preview: Uint8Array,
  options: SerializeOptions = {},
): Uint8Array {
  if (!doc.project) {
    throw new Error("This document is open read-only and cannot be saved.");
  }
  const upgraded = doc.manifest.formatVersion < FORMAT_VERSION;
  const manifest: Manifest = {
    ...doc.manifest,
    formatVersion: Math.max(doc.manifest.formatVersion, FORMAT_VERSION),
    minReaderVersion: upgraded ? FORMAT_VERSION : doc.manifest.minReaderVersion,
    modifiedAt: timestamp(options.now ?? new Date()),
  };
  const json = (value: unknown) => strToU8(`${JSON.stringify(value, null, 2)}\n`);
  const entries: ContainerEntry[] = [
    { name: "manifest.json", data: json(manifest), compress: true },
    { name: "project.json", data: json(doc.project), compress: true },
    { name: "source.png", data: doc.source, compress: false },
    { name: "preview.png", data: preview, compress: false },
    ...Object.keys(doc.assets)
      .sort()
      .map((file) => ({
        name: `assets/${file}`,
        data: doc.assets[file] ?? new Uint8Array(),
        compress: false,
      })),
    ...Object.keys(doc.extraEntries)
      .sort()
      .map((name) => ({ name, data: doc.extraEntries[name] ?? new Uint8Array(), compress: true })),
  ];
  return writeContainer(entries);
}
