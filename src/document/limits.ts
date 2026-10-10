/** The format version this build reads and writes. Bumped with every schema change (docs/FORMAT.md section 5). */
export const FORMAT_VERSION = 1;

/** Hard limits for reading a file (docs/FORMAT.md sections 2 and 7). A file beyond them is rejected, never partly read. */
export interface Limits {
  /** All entries together, after inflating. */
  maxUncompressedBytes: number;
  maxEntries: number;
  /** Longest edge of any image, in pixels. */
  maxImageEdge: number;
  /** One JSON entry (`manifest.json`, `project.json`). */
  maxJsonBytes: number;
  maxLayers: number;
  /** Longest entry name. */
  maxNameLength: number;
}

export const LIMITS: Limits = {
  maxUncompressedBytes: 512 * 1024 * 1024,
  maxEntries: 64,
  maxImageEdge: 16384,
  maxJsonBytes: 8 * 1024 * 1024,
  maxLayers: 5000,
  maxNameLength: 256,
};

/** Coordinates and sizes beyond this are clamped when a file is read (docs/FORMAT.md section 7). */
export const MAX_COORDINATE = 1e6;

/** Fonts bundled with the app, referenced by id (docs/FORMAT.md section 8). Others fall back to the default. */
export const BUNDLED_FONT_IDS: readonly string[] = ["inter", "jetbrains-mono"];
export const DEFAULT_FONT_ID = "inter";
