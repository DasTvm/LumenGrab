import { describe, expect, it } from "vitest";
import { LayerSchema } from "@/document/schema";
import { DEFAULT_OPTIONS } from "../ui/tools";
import {
  dragBox,
  newArrow,
  newBox,
  newCounter,
  newHighlighter,
  newLine,
  newPencil,
  newRedaction,
  newSpotlight,
  newText,
  redactStrengthPercent,
  redactStrengthPx,
} from "./style";

const o = DEFAULT_OPTIONS;
const box = { x: 10, y: 20, width: 30, height: 40 };

describe("new layers", () => {
  it("are valid layers of the file format, whatever the tool", () => {
    const layers = [
      newBox("rect", "a", box, o.rect),
      newBox("ellipse", "b", box, o.ellipse),
      newLine("c", { x: 0, y: 0 }, { x: 5, y: 5 }, o.line),
      newLine("c2", { x: 0, y: 0 }, { x: 5, y: 5 }, { ...o.line, dashed: true }),
      newArrow("d", { x: 0, y: 0 }, { x: 5, y: 5 }, o.arrow),
      newPencil("e", { x: 1, y: 2 }, o.pencil),
      newHighlighter("f", box, o.highlighter),
      newSpotlight("g", box, o.spotlight),
      newRedaction("h", box, o.redact, 42),
      newRedaction("i", box, { ...o.redact, mode: "solid" }, 42),
      newCounter("j", { x: 5, y: 5 }, 3, o.counter),
      newText("k", { x: 5, y: 5 }, o.text),
    ];
    for (const layer of layers) {
      const parsed = LayerSchema.safeParse(layer);
      expect(parsed.success, layer.type).toBe(true);
    }
  });

  it("take their look from the options", () => {
    expect(newBox("rect", "a", box, { ...o.rect, fill: "#2563EB", radius: 3 })).toMatchObject({
      type: "rect",
      x: 10,
      width: 30,
      fill: "#2563EB",
      radius: 3,
      stroke: "#EF4444",
      rotation: 0,
    });
    expect(
      newLine("c", { x: 0, y: 0 }, { x: 1, y: 1 }, { ...o.line, dashed: true, width: 4 }),
    ).toMatchObject({
      dash: [10, 8],
    });
    expect(newLine("c", { x: 0, y: 0 }, { x: 1, y: 1 }, o.line)).not.toHaveProperty("dash");
    expect(
      newArrow("d", { x: 0, y: 0 }, { x: 9, y: 9 }, { ...o.arrow, style: "double" }),
    ).toMatchObject({ style: "double" });
    expect(
      newRedaction("h", box, { ...o.redact, mode: "solid", color: "#112233" }, 7),
    ).toMatchObject({
      mode: "solid",
      color: "#112233",
      strength: 0,
      seed: 7,
    });
    expect(
      newRedaction("h", box, { ...o.redact, mode: "pixelate", strength: 100 }, 7),
    ).toMatchObject({ strength: 48 });
  });
});

describe("drag boxes", () => {
  it("works in any direction, as a square, or around the start point", () => {
    expect(dragBox({ x: 50, y: 50 }, { x: 30, y: 80 }, {})).toEqual({
      x: 30,
      y: 50,
      width: 20,
      height: 30,
    });
    expect(dragBox({ x: 50, y: 50 }, { x: 30, y: 80 }, { square: true })).toEqual({
      x: 20,
      y: 50,
      width: 30,
      height: 30,
    });
    expect(dragBox({ x: 50, y: 50 }, { x: 60, y: 70 }, { center: true })).toEqual({
      x: 40,
      y: 30,
      width: 20,
      height: 40,
    });
  });
});

describe("redaction strength", () => {
  it("maps 0-100 % to pixels and back for blur and pixelate", () => {
    expect(redactStrengthPx("blur", 0)).toBe(4);
    expect(redactStrengthPx("blur", 100)).toBe(40);
    expect(redactStrengthPx("pixelate", 100)).toBe(48);
    for (const mode of ["blur", "pixelate"] as const) {
      for (const pct of [0, 25, 50, 70, 100]) {
        expect(redactStrengthPercent(mode, redactStrengthPx(mode, pct))).toBe(pct);
      }
    }
    expect(redactStrengthPercent("blur", 1)).toBe(0);
    expect(redactStrengthPx("blur", 500)).toBe(40);
  });
});
