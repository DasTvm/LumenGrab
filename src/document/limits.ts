/** The format version this build reads and writes. Bumped with every schema change (docs/FORMAT.md section 5). */
export const FORMAT_VERSION = 3;

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
export const BUNDLED_FONT_IDS: readonly string[] = [
  "inter",
  "jetbrains-mono",
  "lora",
  "fraunces",
  "space-grotesk",
  "oswald",
  "nunito",
  "caveat",
];

/**
 * A font installed on the user's device is referenced as `system:<family name>`. Such a file only looks
 * the same on a device that has the font; elsewhere the default font is used (docs/FORMAT.md section 8).
 */
export const SYSTEM_FONT_PREFIX = "system:";

export const isSystemFontId = (fontId: string): boolean =>
  fontId.startsWith(SYSTEM_FONT_PREFIX) && fontId.length > SYSTEM_FONT_PREFIX.length;

/** The family name of a `system:` font id. */
export const systemFontFamily = (fontId: string): string => fontId.slice(SYSTEM_FONT_PREFIX.length);
export const DEFAULT_FONT_ID = "inter";

/** How many groups may sit inside each other (format v2, docs/FORMAT.md section 4). */
export const MAX_GROUP_DEPTH = 8;
