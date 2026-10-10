import { DocumentError } from "./errors";
import { LIMITS } from "./limits";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Width and height of a PNG, read from its IHDR chunk without decoding the image. Used to enforce
 * the size limit *before* anything tries to decode (and allocate) a hostile picture.
 */
export function readPngSize(
  bytes: Uint8Array,
  what: string,
  maxEdge: number = LIMITS.maxImageEdge,
): { width: number; height: number } {
  const bad = (why: string) => new DocumentError("bad-image", `${what}: ${why}`);
  if (bytes.length < 33) throw bad("not a PNG image");
  for (let i = 0; i < SIGNATURE.length; i += 1) {
    if (bytes[i] !== SIGNATURE[i]) throw bad("not a PNG image");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(
    bytes[12] ?? 0,
    bytes[13] ?? 0,
    bytes[14] ?? 0,
    bytes[15] ?? 0,
  );
  if (view.getUint32(8) !== 13 || chunkType !== "IHDR") throw bad("damaged PNG header");
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) throw bad("empty image");
  if (width > maxEdge || height > maxEdge) {
    throw new DocumentError(
      "image-too-large",
      `${what}: ${String(width)} × ${String(height)} px is larger than ${String(maxEdge)} × ${String(maxEdge)} px`,
    );
  }
  return { width, height };
}
