import { deflateSync, inflateSync } from "node:zlib";
import type { ImageCodec } from "../render/flatten";
import type { RgbaImage } from "../render/pixels";

/** Tests only: a minimal PNG writer and reader (RGBA8) so the format tests need no image library or display. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export interface Rgba {
  width: number;
  height: number;
  /** `width * height * 4` bytes, straight alpha. */
  data: Uint8Array;
}

export function encodePng({ width, height, data }: Rgba): Uint8Array {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw.set(data.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1); // filter 0
  }
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk("IHDR", header),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Reads a non-interlaced 8-bit RGBA or RGB PNG (any scanline filter). */
export function decodePng(png: Uint8Array): Rgba {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const colorType = png[25];
  const channels = colorType === 6 ? 4 : 3;
  const idat: Uint8Array[] = [];
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === "IDAT") idat.push(png.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  const prev = new Uint8Array(stride);
  const line = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)] ?? 0;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[y * (stride + 1) + 1 + x] ?? 0;
      const left = x >= channels ? (line[x - channels] ?? 0) : 0;
      const up = prev[x] ?? 0;
      const upLeft = x >= channels ? (prev[x - channels] ?? 0) : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[x] = (value + predictor) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      out[(y * width + x) * 4] = line[x * channels] ?? 0;
      out[(y * width + x) * 4 + 1] = line[x * channels + 1] ?? 0;
      out[(y * width + x) * 4 + 2] = line[x * channels + 2] ?? 0;
      out[(y * width + x) * 4 + 3] = channels === 4 ? (line[x * channels + 3] ?? 255) : 255;
    }
    prev.set(line);
  }
  return { width, height, data: out };
}

/** A high-contrast test picture: diagonal stripes, so a blur or pixelation cannot leave it unchanged. */
export function stripes(width: number, height: number): Rgba {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = (x + y) % 8 < 4 ? 0 : 255;
      data.set([v, 255 - v, (x * 7) & 255, 255], (y * width + x) * 4);
    }
  }
  return { width, height, data };
}

/** An `ImageCodec` for tests, built on the helpers above. */
export const nodeCodec: ImageCodec = {
  decode(png) {
    const { width, height, data } = decodePng(png);
    return Promise.resolve({ width, height, data: new Uint8ClampedArray(data) });
  },
  encode(image) {
    return Promise.resolve(
      encodePng({ width: image.width, height: image.height, data: new Uint8Array(image.data) }),
    );
  },
};

/** A picture as `RgbaImage` (tests). */
export function asImage({ width, height, data }: Rgba): RgbaImage {
  return { width, height, data: new Uint8ClampedArray(data) };
}
