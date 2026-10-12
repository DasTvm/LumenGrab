import { sha256Hex } from "@/document/hash";
import type { Project } from "@/document/schema";

/** Pictures used as a presentation background live in `assets/` as `<sha256>.<ext>` (docs/FORMAT.md section 2). */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;

/** The file extension of a PNG, JPEG or WebP picture by its first bytes; `null` for anything else. */
export function imageExtension(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpg";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  )
    return "webp";
  return null;
}

/** The asset name of some bytes, or an error message a person can read. */
export async function assetNameOf(
  bytes: Uint8Array,
): Promise<{ name: string } | { error: string }> {
  if (bytes.length > MAX_ASSET_BYTES) return { error: "This picture is larger than 20 MB." };
  const ext = imageExtension(bytes);
  if (!ext) return { error: "Only PNG, JPEG and WebP pictures can be a background." };
  return { name: `${await sha256Hex(bytes)}.${ext}` };
}

/** The assets a project still uses (a background image). */
export function usedAssets(project: Project): string[] {
  const bg = project.presentation.background;
  return bg.type === "image" && bg.asset ? [bg.asset] : [];
}

/** The files to write: only the pictures the project uses (an old background no longer costs space). */
export function pruneAssets(
  assets: Readonly<Record<string, Uint8Array>>,
  project: Project,
): Record<string, Uint8Array> {
  const keep = new Set(usedAssets(project));
  return Object.fromEntries(Object.entries(assets).filter(([name]) => keep.has(name)));
}
