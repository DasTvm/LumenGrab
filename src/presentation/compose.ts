import type { Presentation } from "@/document/schema";

/**
 * The layout of a presentation (docs/FORMAT.md section 4b): how big the canvas is, where the picture
 * (with its window frame) sits, and how the result is scaled for output. Pure numbers, no canvas, so
 * the editor preview, the export and the preview image all agree.
 */

export const MAX_OUTPUT_EDGE = 16384;

export type FrameType = Presentation["frame"]["type"];

/** Height of the title bar of each frame at a content width of 1280 px. */
const BAR: Record<FrameType, number> = {
  none: 0,
  "macos-window": 40,
  "windows-window": 36,
  browser: 52,
  minimal: 24,
  terminal: 36,
};

/** The factor all frame metrics scale with: 1 at a content width of 1280 px, between 0.5 and 4. */
export function frameScale(contentWidth: number): number {
  return Math.min(4, Math.max(0.5, contentWidth / 1280));
}

export function barHeight(type: FrameType, contentWidth: number): number {
  return Math.round(BAR[type] * frameScale(contentWidth));
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  /** The picture without frame. */
  content: { width: number; height: number };
  /** Height of the frame's title bar (0 for no frame). */
  bar: number;
  /** The frame metrics factor. */
  k: number;
  /** Size of the composition before it is scaled for output. */
  canvas: { width: number; height: number };
  /** Picture plus title bar, inside the canvas. */
  unit: Box;
  /** The picture itself (below the title bar). */
  contentBox: Box;
  /** Corner radius actually used. */
  radius: number;
  /** Composition pixel to output pixel. */
  scale: number;
  output: { width: number; height: number };
  /** The output was scaled down to stay within 16 384 px. */
  clamped: boolean;
}

const px = (value: number) => Math.max(0, Number.isFinite(value) ? value : 0);

/** The canvas shape wanted by the aspect settings, or null for "as it comes". */
export function targetRatio(aspect: Presentation["aspect"]): number | null {
  if (aspect.size) return aspect.size[0] / aspect.size[1];
  if (aspect.mode === "fixed" && aspect.ratio) return aspect.ratio[0] / aspect.ratio[1];
  return null;
}

export function computeLayout(
  content: { width: number; height: number },
  presentation: Presentation,
): Layout {
  const width = Math.max(1, content.width);
  const height = Math.max(1, content.height);
  const { padding, frame, aspect } = presentation;
  const k = frameScale(width);
  const bar = barHeight(frame.type, width);
  const unitWidth = width;
  const unitHeight = height + bar;
  const needW = unitWidth + px(padding.left) + px(padding.right);
  const needH = unitHeight + px(padding.top) + px(padding.bottom);

  let canvasW = needW;
  let canvasH = needH;
  const ratio = targetRatio(aspect);
  if (ratio !== null) {
    if (needW / needH < ratio) canvasW = needH * ratio;
    else canvasH = needW / ratio;
  }
  canvasW = Math.max(1, Math.round(canvasW));
  canvasH = Math.max(1, Math.round(canvasH));

  const unit: Box = {
    x: px(padding.left) + (canvasW - needW) / 2,
    y: px(padding.top) + (canvasH - needH) / 2,
    width: unitWidth,
    height: unitHeight,
  };
  const radius = Math.min(px(presentation.cornerRadius), unit.width / 2, unit.height / 2);

  let scale = presentation.exportScale;
  let output: { width: number; height: number };
  let clamped = false;
  if (aspect.size) {
    scale = aspect.size[0] / canvasW;
    output = { width: aspect.size[0], height: aspect.size[1] };
  } else {
    const longest = Math.max(canvasW, canvasH) * scale;
    if (longest > MAX_OUTPUT_EDGE) {
      scale *= MAX_OUTPUT_EDGE / longest;
      clamped = true;
    }
    output = {
      width: Math.max(1, Math.round(canvasW * scale)),
      height: Math.max(1, Math.round(canvasH * scale)),
    };
  }

  return {
    content: { width, height },
    bar,
    k,
    canvas: { width: canvasW, height: canvasH },
    unit,
    contentBox: { x: unit.x, y: unit.y + bar, width, height },
    radius,
    scale,
    output,
    clamped,
  };
}

/** Same padding on all four sides: the mean of the four (the "Balance edges" button). */
export function balancedPadding(padding: Presentation["padding"]): Presentation["padding"] {
  const value = Math.round((padding.top + padding.right + padding.bottom + padding.left) / 4);
  return { top: value, right: value, bottom: value, left: value };
}

/** Where a picture of `src` size lands when it fills `dst` (cover) or fits inside it (contain), centred; `zoom` enlarges a cover. */
export function fitBox(
  src: { width: number; height: number },
  dst: { width: number; height: number },
  fit: "cover" | "contain",
  zoom = 1,
): Box {
  const sx = dst.width / Math.max(1, src.width);
  const sy = dst.height / Math.max(1, src.height);
  const s = (fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy)) * zoom;
  const width = src.width * s;
  const height = src.height * s;
  return { x: (dst.width - width) / 2, y: (dst.height - height) / 2, width, height };
}
