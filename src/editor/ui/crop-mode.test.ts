import { describe, expect, it } from "vitest";
import { createEditorStore } from "../model/store";
import { projectWith } from "../model/test-layers";
import {
  applyCrop,
  cancelCrop,
  dragCropHandle,
  dragNewCrop,
  moveCropBy,
  resetCrop,
  setCropPreset,
  setCropSize,
  startCrop,
  swapCrop,
  toggleCropLock,
} from "./crop-mode";
import { createUiStore } from "./ui-store";

function setup(crop: { x: number; y: number; width: number; height: number } | null = null) {
  const editor = createEditorStore({ ...projectWith([]), crop });
  const ui = createUiStore({ width: 1000, height: 600 });
  ui.getState().setArea({ width: 800, height: 600 });
  ui.getState().setTool("crop");
  startCrop(editor, ui);
  return { editor, ui };
}
const rect = (s: ReturnType<typeof setup>) => s.ui.getState().crop?.rect;

describe("crop mode", () => {
  it("opens on the whole picture with the original ratio, and fits the whole picture into the view", () => {
    const s = setup();
    expect(s.ui.getState().crop).toEqual({
      rect: { x: 0, y: 0, width: 1000, height: 600 },
      preset: "original",
      ratio: 1000 / 600,
    });
    expect(s.ui.getState().view?.zoom).toBeLessThan(1);
    expect(s.ui.getState().fit).toBe(true);
  });

  it("opens on the current crop, free if its ratio is not the picture's", () => {
    const s = setup({ x: 100, y: 50, width: 400, height: 300 });
    expect(s.ui.getState().crop).toMatchObject({
      rect: { x: 100, y: 50, width: 400, height: 300 },
      preset: "free",
      ratio: null,
    });
  });

  it("Apply writes the crop as one undo step and leaves the tool; Undo gives the full picture back", () => {
    const s = setup();
    setCropPreset(s.ui, "free");
    dragCropHandle(s.ui, "se", { x: 600, y: 400 });
    applyCrop(s.editor, s.ui);
    expect(s.editor.getState().project.crop).toEqual({ x: 0, y: 0, width: 600, height: 400 });
    expect(s.ui.getState().tool).toBe("select");
    expect(s.ui.getState().crop).toBeNull();
    s.editor.getState().undo();
    expect(s.editor.getState().project.crop).toBeNull();
    expect(s.editor.getState().canUndo).toBe(false);
  });

  it("a frame that covers the whole picture is no crop at all", () => {
    const s = setup({ x: 10, y: 10, width: 500, height: 300 });
    resetCrop(s.ui);
    applyCrop(s.editor, s.ui);
    expect(s.editor.getState().project.crop).toBeNull();
    s.editor.getState().undo();
    expect(s.editor.getState().project.crop).toEqual({ x: 10, y: 10, width: 500, height: 300 });
  });

  it("Cancel changes nothing, and Apply without a change adds no undo step", () => {
    const s = setup({ x: 10, y: 10, width: 500, height: 300 });
    dragCropHandle(s.ui, "se", { x: 900, y: 500 });
    cancelCrop(s.editor, s.ui);
    expect(s.editor.getState().project.crop).toEqual({ x: 10, y: 10, width: 500, height: 300 });
    expect(s.editor.getState().canUndo).toBe(false);
    expect(s.ui.getState().tool).toBe("select");
    startCrop(s.editor, s.ui);
    applyCrop(s.editor, s.ui);
    expect(s.editor.getState().canUndo).toBe(false);
    expect(s.editor.getState().dirty).toBe(false);
  });

  it("keeps the frame in the picture and in its ratio while a handle is dragged", () => {
    const s = setup();
    setCropPreset(s.ui, "1:1");
    expect(rect(s)).toEqual({ x: 200, y: 0, width: 600, height: 600 });
    dragCropHandle(s.ui, "nw", { x: 400, y: 200 });
    const r = rect(s);
    expect(r && r.width / r.height).toBeCloseTo(1, 1);
    expect(r && r.x + r.width).toBe(800);
    dragCropHandle(s.ui, "se", { x: 5000, y: 5000 });
    const big = rect(s);
    expect(big && big.x + big.width).toBeLessThanOrEqual(1000);
    expect(big && big.y + big.height).toBeLessThanOrEqual(600);
  });

  it("picks 4:3 and 16:9 inside the current frame, around its middle", () => {
    const s = setup();
    setCropPreset(s.ui, "4:3");
    expect(rect(s)).toEqual({ x: 100, y: 0, width: 800, height: 600 });
    setCropPreset(s.ui, "16:9");
    const r = rect(s);
    expect(r && Math.abs(r.width / r.height - 16 / 9)).toBeLessThan(0.01);
    expect(s.ui.getState().crop?.preset).toBe("16:9");
    setCropPreset(s.ui, "free");
    expect(s.ui.getState().crop?.ratio).toBeNull();
  });

  it("swaps a ratio on its side and a free frame's sides", () => {
    const s = setup();
    setCropPreset(s.ui, "4:3");
    swapCrop(s.ui);
    const r = rect(s);
    expect(r && r.height).toBeGreaterThan(r?.width ?? 0);
    expect(s.ui.getState().crop?.preset).toBe("custom");
    resetCrop(s.ui);
    setCropPreset(s.ui, "free");
    dragCropHandle(s.ui, "se", { x: 400, y: 300 });
    swapCrop(s.ui);
    expect(rect(s)).toMatchObject({ width: 300, height: 400 });
  });

  it("the W and H fields follow the ratio when it is locked, and not when it is free", () => {
    const s = setup();
    setCropPreset(s.ui, "free");
    dragCropHandle(s.ui, "se", { x: 400, y: 300 });
    setCropSize(s.ui, "width", 320);
    expect(rect(s)).toMatchObject({ width: 320, height: 300 });
    toggleCropLock(s.ui);
    expect(s.ui.getState().crop?.ratio).toBeCloseTo(320 / 300);
    setCropSize(s.ui, "width", 640);
    expect(rect(s)).toMatchObject({ width: 640, height: 600 });
    setCropSize(s.ui, "height", 150);
    expect(rect(s)).toMatchObject({ width: 160, height: 150 });
    toggleCropLock(s.ui);
    expect(s.ui.getState().crop).toMatchObject({ ratio: null, preset: "free" });
    setCropSize(s.ui, "width", 5000); // never bigger than the picture
    expect(rect(s)?.width).toBe(1000);
  });

  it("moves the frame without leaving the picture, and a new frame can be dragged out", () => {
    const s = setup();
    setCropPreset(s.ui, "free");
    dragCropHandle(s.ui, "se", { x: 400, y: 300 });
    const from = rect(s);
    if (!from) throw new Error("rect");
    moveCropBy(s.ui, from, 100, 50);
    expect(rect(s)).toMatchObject({ x: 100, y: 50, width: 400, height: 300 });
    moveCropBy(s.ui, from, 5000, 5000);
    expect(rect(s)).toMatchObject({ x: 600, y: 300 });
    dragNewCrop(s.ui, { x: 500, y: 400 }, { x: 300, y: 250 });
    expect(rect(s)).toEqual({ x: 300, y: 250, width: 200, height: 150 });
    setCropPreset(s.ui, "1:1");
    dragNewCrop(s.ui, { x: 100, y: 100 }, { x: 300, y: 150 });
    expect(rect(s)).toMatchObject({ width: 50, height: 50 });
  });

  it("Reset goes back to the full picture and the original ratio", () => {
    const s = setup({ x: 10, y: 10, width: 500, height: 300 });
    resetCrop(s.ui);
    expect(s.ui.getState().crop).toEqual({
      rect: { x: 0, y: 0, width: 1000, height: 600 },
      preset: "original",
      ratio: 1000 / 600,
    });
  });
});
