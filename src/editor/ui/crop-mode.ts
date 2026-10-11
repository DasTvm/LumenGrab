import type { Rect } from "@/document/schema";
import { clampRect, fitAspect, resizeCrop, type Handle } from "../model/geometry";
import type { EditorStoreApi } from "../model/store";
import type { CropDraft, CropPreset, UiStoreApi } from "./ui-store";
import { fitView } from "./view";

/**
 * The crop tool (design: Crop mode). Opening it shows the whole picture with a frame; nothing changes in
 * the document until Apply, which sets `project.crop` as one undo step. The original picture is never
 * touched (AGENTS.md section 5, rule 7): Reset or a new crop can always go back to the full picture.
 */

const MIN_SIDE = 8;

export const PRESET_RATIOS: Record<Exclude<CropPreset, "free" | "original" | "custom">, number> = {
  "1:1": 1,
  "4:3": 4 / 3,
  "16:9": 16 / 9,
};

const round = (r: Rect): Rect => {
  const x = Math.max(0, Math.round(r.x));
  const y = Math.max(0, Math.round(r.y));
  return {
    x,
    y,
    width: Math.max(1, Math.round(r.width)),
    height: Math.max(1, Math.round(r.height)),
  };
};

export const isFullPicture = (r: Rect, image: { width: number; height: number }): boolean =>
  r.x === 0 && r.y === 0 && r.width === image.width && r.height === image.height;

/** The frame the tool opens with: the current crop, or the whole picture. */
export function startCrop(editor: EditorStoreApi, ui: UiStoreApi): void {
  const image = ui.getState().imageSize;
  const current = editor.getState().project.crop;
  const rect = current ? round(current) : { x: 0, y: 0, ...image };
  const original = image.width / image.height;
  const sameShape = Math.abs(rect.width / rect.height - original) < 0.005;
  ui.getState().setCrop({
    rect,
    preset: sameShape ? "original" : "free",
    ratio: sameShape ? original : null,
  });
  refit(ui, { x: 0, y: 0, ...image });
}

function refit(ui: UiStoreApi, content: Rect): void {
  ui.getState().setView(fitView(ui.getState().area, content), true);
}

/** Leaves the tool. `content` is what the canvas shows afterwards. */
function leave(editor: EditorStoreApi, ui: UiStoreApi): void {
  ui.getState().setCrop(null);
  ui.getState().setTool("select");
  const image = ui.getState().imageSize;
  refit(ui, editor.getState().project.crop ?? { x: 0, y: 0, ...image });
}

export function applyCrop(editor: EditorStoreApi, ui: UiStoreApi): void {
  const draft = ui.getState().crop;
  if (!draft) return;
  const image = ui.getState().imageSize;
  const rect = clampRect(round(draft.rect), image, 1);
  const next = isFullPicture(rect, image) ? null : rect;
  const before = editor.getState().project.crop;
  const same =
    (next === null && before === null) ||
    (next !== null &&
      before !== null &&
      next.x === before.x &&
      next.y === before.y &&
      next.width === before.width &&
      next.height === before.height);
  if (!same) {
    editor.getState().change((p) => {
      p.crop = next;
    });
  }
  leave(editor, ui);
}

export function cancelCrop(editor: EditorStoreApi, ui: UiStoreApi): void {
  if (ui.getState().crop) leave(editor, ui);
}

/** Back to the whole picture and the original ratio, still in the tool. */
export function resetCrop(ui: UiStoreApi): void {
  const image = ui.getState().imageSize;
  ui.getState().setCrop({
    rect: { x: 0, y: 0, ...image },
    preset: "original",
    ratio: image.width / image.height,
  });
}

function update(ui: UiStoreApi, change: Partial<CropDraft>): void {
  const draft = ui.getState().crop;
  if (draft) ui.getState().setCrop({ ...draft, ...change });
}

/** Fits a ratio into the current frame, around its centre. */
function withRatio(rect: Rect, ratio: number, image: { width: number; height: number }): Rect {
  const fitted = fitAspect(rect, ratio);
  return clampRect(
    { x: rect.x + fitted.x, y: rect.y + fitted.y, width: fitted.width, height: fitted.height },
    image,
    MIN_SIDE,
  );
}

export function setCropPreset(ui: UiStoreApi, preset: CropPreset): void {
  const draft = ui.getState().crop;
  if (!draft) return;
  const image = ui.getState().imageSize;
  if (preset === "free") {
    update(ui, { preset, ratio: null });
    return;
  }
  const ratio =
    preset === "original"
      ? image.width / image.height
      : preset === "custom"
        ? draft.rect.width / draft.rect.height
        : PRESET_RATIOS[preset];
  update(ui, { preset, ratio, rect: round(withRatio(draft.rect, ratio, image)) });
}

/** Turns the ratio on its side (4:3 becomes 3:4); a free frame swaps its width and height. */
export function swapCrop(ui: UiStoreApi): void {
  const draft = ui.getState().crop;
  if (!draft) return;
  const image = ui.getState().imageSize;
  if (draft.ratio === null) {
    const { rect } = draft;
    update(ui, {
      rect: round(clampRect({ ...rect, width: rect.height, height: rect.width }, image, MIN_SIDE)),
    });
    return;
  }
  const ratio = 1 / draft.ratio;
  update(ui, { ratio, preset: "custom", rect: round(withRatio(draft.rect, ratio, image)) });
}

/** The lock between W and H: locked keeps today's ratio, unlocked is free. */
export function toggleCropLock(ui: UiStoreApi): void {
  const draft = ui.getState().crop;
  if (!draft) return;
  if (draft.ratio === null) {
    update(ui, { ratio: draft.rect.width / draft.rect.height, preset: "custom" });
  } else {
    update(ui, { ratio: null, preset: "free" });
  }
}

/** The W or H field: sets one side (the other follows when the ratio is locked). Anchored at the top left. */
export function setCropSize(ui: UiStoreApi, side: "width" | "height", value: number): void {
  const draft = ui.getState().crop;
  if (!draft || !Number.isFinite(value)) return;
  const image = ui.getState().imageSize;
  const { rect, ratio } = draft;
  const wanted = Math.max(MIN_SIDE, Math.round(value));
  let width = side === "width" ? wanted : rect.width;
  let height = side === "height" ? wanted : rect.height;
  if (ratio !== null) {
    if (side === "width") height = Math.round(width / ratio);
    else width = Math.round(height * ratio);
    // Keep the ratio when the picture is not big enough.
    const shrink = Math.min(1, image.width / width, image.height / height);
    width = Math.round(width * shrink);
    height = Math.round(height * shrink);
  }
  update(ui, { rect: round(clampRect({ x: rect.x, y: rect.y, width, height }, image, MIN_SIDE)) });
}

/** Drags a handle of the frame to an image point. */
export function dragCropHandle(ui: UiStoreApi, handle: Handle, to: { x: number; y: number }): void {
  const draft = ui.getState().crop;
  if (!draft) return;
  // Whole pixels all the way, so the badge, the fields and the saved crop always agree.
  const rect = resizeCrop(draft.rect, handle, to, ui.getState().imageSize, draft.ratio, MIN_SIDE);
  update(ui, { rect: round(rect) });
}

/** Moves the whole frame by a delta, staying inside the picture. */
export function moveCropBy(ui: UiStoreApi, from: Rect, dx: number, dy: number): void {
  const image = ui.getState().imageSize;
  update(ui, { rect: round(clampRect({ ...from, x: from.x + dx, y: from.y + dy }, image, 1)) });
}

/** A new frame dragged out on the picture, held to the ratio if there is one. */
export function dragNewCrop(
  ui: UiStoreApi,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const draft = ui.getState().crop;
  if (!draft) return;
  const image = ui.getState().imageSize;
  const x0 = Math.max(0, Math.min(image.width, from.x));
  const y0 = Math.max(0, Math.min(image.height, from.y));
  const x1 = Math.max(0, Math.min(image.width, to.x));
  const y1 = Math.max(0, Math.min(image.height, to.y));
  let width = Math.abs(x1 - x0);
  let height = Math.abs(y1 - y0);
  if (draft.ratio !== null) {
    if (width / Math.max(height, 1) > draft.ratio) width = height * draft.ratio;
    else height = width / draft.ratio;
  }
  const rect = {
    x: x1 < x0 ? x0 - width : x0,
    y: y1 < y0 ? y0 - height : y0,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
  update(ui, { rect: round(clampRect(rect, image, 1)) });
}
