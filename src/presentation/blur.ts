import { boxBlurAxis, type RgbaImage } from "@/document/render/pixels";

/**
 * A gaussian blur by three box passes in each direction, edges clamped (so the border does not fade
 * to nothing). `sigma` is in pixels; 0 or less returns the image unchanged. Used for the blurred
 * backgrounds, at a reduced size.
 */
export function blurImage(image: RgbaImage, sigma: number): RgbaImage {
  if (sigma < 0.5) return image;
  // Three passes of width w have the variance of a gaussian when w = sqrt(12 sigma² / 3 + 1).
  const radius = Math.max(1, Math.round((Math.sqrt((12 * sigma * sigma) / 3 + 1) - 1) / 2));
  const work = new Float32Array(image.data.length);
  work.set(image.data);
  for (let pass = 0; pass < 3; pass += 1) {
    boxBlurAxis(work, image.width, image.height, 4, image.width * 4, radius);
    boxBlurAxis(work, image.height, image.width, image.width * 4, 4, radius);
  }
  return { width: image.width, height: image.height, data: new Uint8ClampedArray(work) };
}

/** Saturation (1 = unchanged) and a black layer of `dim` (0..1), in place. */
export function adjustImage(image: RgbaImage, saturation: number, dim: number): void {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const keep = 1 - dim;
    data[i] = (gray + (r - gray) * saturation) * keep;
    data[i + 1] = (gray + (g - gray) * saturation) * keep;
    data[i + 2] = (b * saturation + gray * (1 - saturation)) * keep;
  }
}
