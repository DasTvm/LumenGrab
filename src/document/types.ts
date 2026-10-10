import type { Manifest, Project } from "./schema";

/** A `.lumengrab` file, unpacked. Everything the app needs to show, edit and write it back. */
export interface DocumentFile {
  manifest: Manifest;
  /**
   * The editable project. `null` only for a file opened read-only (it may be newer than this
   * version's schema): such a file can be viewed from `preview` and `manifest`, never saved.
   */
  project: Project | null;
  /** `source.png`: the original image, exactly as captured. Never modified. */
  source: Uint8Array;
  /** `preview.png`, or `null` if the file has none. */
  preview: Uint8Array | null;
  /** Files of `assets/`, by file name (`<sha256>.<ext>`, without the folder). */
  assets: Record<string, Uint8Array>;
  /** Entries this version does not know, by full entry name. Written back unchanged. */
  extraEntries: Record<string, Uint8Array>;
}

/** Why a file is open for viewing only (docs/FORMAT.md section 3). */
export interface ReadOnlyInfo {
  reason: "newer-version";
  /** The `formatVersion` the file was written with. */
  fileVersion: number;
  /** The lowest format version that can edit it. */
  minReaderVersion: number;
  /** The format version this app supports. */
  supportedVersion: number;
}

export type DocumentWarningCode =
  | "source-hash"
  | "source-size"
  | "missing-asset"
  | "asset-hash"
  | "unknown-font"
  | "missing-preview";

/** Something odd that does not stop the file from opening. Shown as a notice, never a crash. */
export interface DocumentWarning {
  code: DocumentWarningCode;
  message: string;
}

export interface OpenedDocument {
  doc: DocumentFile;
  warnings: DocumentWarning[];
  readOnly: ReadOnlyInfo | null;
}
