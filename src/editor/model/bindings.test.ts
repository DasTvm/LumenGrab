import { describe, expect, it } from "vitest";
import { DEFAULT_OPTIONS } from "../ui/tools";
import { applyOptions, isStyleTool, layerIsOf, optionsFromLayer } from "./bindings";
import {
  newArrow,
  newBox,
  newCounter,
  newHighlighter,
  newLine,
  newPencil,
  newRedaction,
  newSpotlight,
  newText,
} from "./style";

const o = DEFAULT_OPTIONS;
const box = { x: 0, y: 0, width: 10, height: 10 };
const p = { x: 0, y: 0 };

describe("panel bindings", () => {
  it("reads the options back from a layer made from them (round trip)", () => {
    expect(optionsFromLayer("arrow", newArrow("a", p, p, o.arrow))).toEqual(o.arrow);
    expect(optionsFromLayer("line", newLine("a", p, p, o.line))).toEqual(o.line);
    expect(optionsFromLayer("line", newLine("a", p, p, { ...o.line, dashed: true }))).toEqual({
      ...o.line,
      dashed: true,
    });
    expect(optionsFromLayer("rect", newBox("rect", "a", box, o.rect))).toEqual(o.rect);
    expect(optionsFromLayer("ellipse", newBox("ellipse", "a", box, o.ellipse))).toEqual(o.ellipse);
    expect(optionsFromLayer("text", newText("a", p, o.text))).toEqual(o.text);
    expect(optionsFromLayer("counter", newCounter("a", p, 1, o.counter))).toEqual(o.counter);
    expect(optionsFromLayer("highlighter", newHighlighter("a", box, o.highlighter))).toEqual(
      o.highlighter,
    );
    expect(optionsFromLayer("pencil", newPencil("a", p, o.pencil))).toEqual(o.pencil);
    expect(optionsFromLayer("spotlight", newSpotlight("a", box, o.spotlight))).toEqual(o.spotlight);
    expect(optionsFromLayer("redact", newRedaction("a", box, o.redact, 1))).toMatchObject({
      mode: "blur",
      strength: 70,
    });
  });

  it("writes a change into a layer", () => {
    const rect = newBox("rect", "a", box, o.rect);
    applyOptions("rect", rect, { fill: "#2563EB", radius: 12 });
    expect(rect).toMatchObject({ fill: "#2563EB", radius: 12, stroke: "#EF4444" });
    applyOptions("rect", rect, { fill: null });
    expect(rect["fill"]).toBeNull();
    const arrow = newArrow("a", p, p, o.arrow);
    applyOptions("arrow", arrow, { style: "curved", width: 9 });
    expect(arrow).toMatchObject({ style: "curved", width: 9 });
  });

  it("turns a line dashed and solid again, and keeps the rhythm when the width changes", () => {
    const line = newLine("a", p, p, o.line);
    applyOptions("line", line, { dashed: true });
    expect(line["dash"]).toEqual([10, 8]);
    applyOptions("line", line, { width: 8 });
    expect(line["dash"]).toEqual([20, 16]);
    applyOptions("line", line, { dashed: false });
    expect(line).not.toHaveProperty("dash");
  });

  it("changes a redaction's mode and keeps its strength sensible, solid keeps its colour", () => {
    const r = newRedaction("a", box, { ...o.redact, strength: 50 }, 1);
    applyOptions("redact", r, { mode: "pixelate" });
    expect(r).toMatchObject({ mode: "pixelate", strength: 26 }); // 50 % of 4..48
    applyOptions("redact", r, { strength: 100 });
    expect(r["strength"]).toBe(48);
    applyOptions("redact", r, { mode: "solid" });
    expect(r).toMatchObject({ mode: "solid", strength: 0, color: "#000000" });
    applyOptions("redact", r, { color: "#FFFFFF" });
    expect(r["color"]).toBe("#FFFFFF");
    applyOptions("redact", r, { mode: "blur" });
    expect(r["strength"]).toBe(redactPx(70)); // back to the default strength, not 0
  });

  it("knows which layers a tool's panel edits", () => {
    expect(layerIsOf("rect", newBox("rect", "a", box, o.rect))).toBe(true);
    expect(layerIsOf("rect", newBox("ellipse", "a", box, o.ellipse))).toBe(false);
    expect(layerIsOf("redact", newRedaction("a", box, o.redact, 1))).toBe(true);
    expect(isStyleTool("select")).toBe(false);
    expect(isStyleTool("crop")).toBe(false);
    expect(isStyleTool("text")).toBe(true);
  });
});

function redactPx(percent: number): number {
  return Math.round((4 + (percent / 100) * 36) * 100) / 100;
}
