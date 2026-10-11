import type { Layer, Redaction } from "@/document/schema";
import {
  applyRedaction,
  cloneImage,
  visibleRedactions,
  type RgbaImage,
} from "@/document/render/pixels";

/** A pixel rectangle inside the picture. */
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

const key = (r: Redaction, index: number) =>
  JSON.stringify([index, r.id, r.mode, r.rect, r.strength, r.color ?? null, r.seed]);

function clamp(rect: Region, width: number, height: number): Region | null {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.height));
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : null;
}

const union = (a: Region, b: Region): Region => {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const x1 = Math.max(a.x + a.width, b.x + b.width);
  const y1 = Math.max(a.y + a.height, b.y + b.height);
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

const touches = (a: Region, b: Region): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/**
 * The source picture with the redactions baked in, kept up to date **incrementally**. A redaction only
 * changes pixels inside its own rectangle (blur clamps at the box edge, pixelate and solid fill it), so
 * when one is added, moved, resized or changed, only the rectangles it touched, before and after, are put
 * back from the source and redone, together with every redaction that overlaps them. That makes dragging a
 * blur over a 5K screenshot cheap, and the result is exactly what a full redo gives (tested against it).
 */
export class IncrementalRedactions {
  readonly image: RgbaImage;
  private previous = new Map<string, { rect: Region | null; index: number }>();
  private order: Redaction[] = [];

  constructor(private readonly source: RgbaImage) {
    this.image = cloneImage(source);
  }

  /**
   * Brings the picture up to date with `layers`. Returns the region that changed (to repaint), or
   * `null` if nothing did.
   */
  update(layers: readonly Layer[]): Region | null {
    const { width, height } = this.source;
    const next = visibleRedactions(layers);
    const nextKeys = next.map((r, i) => key(r, i));
    const nextSet = new Set(nextKeys);
    const marks: Region[] = [];
    const mark = (rect: Region | null) => {
      if (rect) marks.push(rect);
    };
    // What went away or changed: the place it was.
    for (const [k, old] of this.previous) if (!nextSet.has(k)) mark(old.rect);
    // What is new or changed: the place it is now.
    next.forEach((r, i) => {
      if (!this.previous.has(nextKeys[i] ?? "")) mark(clamp(r.rect, width, height));
    });
    const first = marks[0];
    if (!first) return null;

    // Everything that overlaps the dirty region must be redone with it, and that can widen it.
    let region: Region = marks.reduce(union, first);
    for (let grew = true; grew;) {
      grew = false;
      for (const r of next) {
        const rect = clamp(r.rect, width, height);
        if (!rect || !touches(rect, region)) continue;
        const merged = union(region, rect);
        if (
          merged.width !== region.width ||
          merged.height !== region.height ||
          merged.x !== region.x ||
          merged.y !== region.y
        ) {
          region = merged;
          grew = true;
        }
      }
    }

    // Put the source back in that region, then redo the redactions that touch it, bottom to top.
    const { data } = this.image;
    const original = this.source.data;
    for (let y = region.y; y < region.y + region.height; y += 1) {
      const from = (y * width + region.x) * 4;
      data.set(original.subarray(from, from + region.width * 4), from);
    }
    for (const r of next) {
      const rect = clamp(r.rect, width, height);
      if (rect && touches(rect, region)) applyRedaction(this.image, r);
    }

    this.order = next;
    this.previous = new Map(
      next.map((r, i) => [nextKeys[i] ?? "", { rect: clamp(r.rect, width, height), index: i }]),
    );
    return region;
  }

  /** The redactions applied at the last update, bottom to top. */
  get applied(): readonly Redaction[] {
    return this.order;
  }
}
