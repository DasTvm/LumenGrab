import { strToU8, zipSync, type Zippable } from "fflate";
import { sha256Hex } from "../hash";
import { defaultProject } from "../write";
import { encodePng, stripes } from "./png";

/** Tests only: assemble raw `.lumengrab` files, including broken and hostile ones, without our own writer. */

export const SOURCE_PNG = encodePng(stripes(32, 24));

export async function goodManifest(): Promise<Record<string, unknown>> {
  return {
    format: "lumengrab",
    formatVersion: 1,
    minReaderVersion: 1,
    createdBy: "LumenGrab test",
    createdAt: "2026-10-06T12:00:00Z",
    modifiedAt: "2026-10-06T12:05:00Z",
    documentId: "11111111-2222-4333-8444-555555555555",
    source: {
      file: "source.png",
      width: 32,
      height: 24,
      scale: 2,
      sha256: await sha256Hex(SOURCE_PNG),
    },
  };
}

export function goodProject(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(defaultProject())) as Record<string, unknown>;
}

export interface RawFile {
  manifest?: unknown;
  project?: unknown;
  /** Extra or replacement entries; `null` removes one. */
  entries?: Record<string, Uint8Array | null>;
}

export async function rawFile({
  manifest,
  project,
  entries = {},
}: RawFile = {}): Promise<Uint8Array> {
  const files: Record<string, Uint8Array | null> = {
    "manifest.json": strToU8(JSON.stringify(manifest ?? (await goodManifest()))),
    "project.json": strToU8(JSON.stringify(project ?? goodProject())),
    "source.png": SOURCE_PNG,
    "preview.png": SOURCE_PNG,
    ...entries,
  };
  const zippable: Zippable = {};
  for (const [name, data] of Object.entries(files)) {
    if (data) zippable[name] = data;
  }
  return zipSync(zippable);
}
