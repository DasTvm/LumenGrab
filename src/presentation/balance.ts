import type { Rect } from "@/document/schema";
import { cropImage, type RgbaImage } from "@/document/render/pixels";

/**
 * "Trim empty edges": finds the empty space around the content of a picture (a wide white strip on the
 * right, a transparent band at the bottom) and the crop that leaves the same amount on every side, the
 * smallest of the four. It is only a crop (undoable, the original is untouched). Pure pixel code.
 */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** How far a pixel may differ from the empty colour, per channel, and still count as empty (compression noise, anti-aliasing). */
export const DEFAULT_TOLERANCE = 8;

type Rgba = [number, number, number, number];

const pixel = (image: RgbaImage, x: number, y: number): Rgba => {
  const at = (y * image.width + x) * 4;
  return [
    image.data[at] ?? 0,
    image.data[at + 1] ?? 0,
    image.data[at + 2] ?? 0,
    image.data[at + 3] ?? 0,
  ];
};

/** Both transparent, or every channel within `tolerance`. */
function near(a: Rgba, b: Rgba, tolerance: number): boolean {
  if (a[3] < tolerance && b[3] < tolerance) return true;
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance &&
    Math.abs(a[3] - b[3]) <= tolerance
  );
}

/** The colour of the empty space: the one that at least two corners share, or `null` if the corners disagree. */
export function emptyColor(image: RgbaImage, tolerance = DEFAULT_TOLERANCE): Rgba | null {
  const { width, height } = image;
  const corners = [
    pixel(image, 0, 0),
    pixel(image, width - 1, 0),
    pixel(image, 0, height - 1),
    pixel(image, width - 1, height - 1),
  ];
  let best: { color: Rgba; votes: number } | null = null;
  for (const color of corners) {
    const votes = corners.filter((c) => near(c, color, tolerance)).length;
    if (!best || votes > best.votes) best = { color, votes };
  }
  return best && best.votes >= 2 ? best.color : null;
}

/** How many lines from each side are empty, scanning inwards until the first line with content. */
export function findMargins(image: RgbaImage, tolerance = DEFAULT_TOLERANCE): Margins | null {
  const { width, height } = image;
  if (width < 2 || height < 2) return null;
  const empty = emptyColor(image, tolerance);
  if (!empty) return null;
  const rowEmpty = (y: number) => {
    for (let x = 0; x < width; x += 1)
      if (!near(pixel(image, x, y), empty, tolerance)) return false;
    return true;
  };
  const columnEmpty = (x: number, from: number, to: number) => {
    for (let y = from; y < to; y += 1)
      if (!near(pixel(image, x, y), empty, tolerance)) return false;
    return true;
  };
  let top = 0;
  while (top < height && rowEmpty(top)) top += 1;
  if (top === height) return null; // nothing but empty space
  let bottom = 0;
  while (bottom < height - top && rowEmpty(height - 1 - bottom)) bottom += 1;
  // The sides are measured between the content rows only, so a full-width empty band does not hide them.
  const yFrom = top;
  const yTo = height - bottom;
  let left = 0;
  while (left < width && columnEmpty(left, yFrom, yTo)) left += 1;
  let right = 0;
  while (right < width - left && columnEmpty(width - 1 - right, yFrom, yTo)) right += 1;
  return { top, right, bottom, left };
}

/**
 * The crop (in picture pixels) that gives every side the smallest of the four margins, or `null` when
 * the margins are already equal (or there is nothing to find). `area` is the picture the margins were
 * measured in (a crop of the source or the whole source); the result is in source pixels.
 */
export function balanceCrop(
  image: RgbaImage,
  area: Rect | null,
  tolerance = DEFAULT_TOLERANCE,
): Rect | null {
  const origin = area ? { x: Math.round(area.x), y: Math.round(area.y) } : { x: 0, y: 0 };
  const picture = area ? cropImage(image, area) : image;
  const margins = findMargins(picture, tolerance);
  if (!margins) return null;
  const keep = Math.min(margins.top, margins.right, margins.bottom, margins.left);
  const cut = {
    top: margins.top - keep,
    right: margins.right - keep,
    bottom: margins.bottom - keep,
    left: margins.left - keep,
  };
  if (cut.top + cut.right + cut.bottom + cut.left === 0) return null;
  return {
    x: origin.x + cut.left,
    y: origin.y + cut.top,
    width: picture.width - cut.left - cut.right,
    height: picture.height - cut.top - cut.bottom,
  };
}
