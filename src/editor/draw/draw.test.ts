import { describe, expect, it } from "vitest";
import { smoothPoints } from "../model/geometry";
import { arrowShape, headLength } from "./arrow";
import { contrastColor, cssColor } from "./color";
import { counterFontSize } from "./draw";
import { fontFamily, fontString, layoutText } from "./text";

/** A font where every character is 10 px wide. */
const mono = (s: string) => s.length * 10;
const input = (text: string, width: number | null, align = "left") => ({
  text,
  width,
  size: 20,
  align,
});

describe("colours", () => {
  it("turns hex into rgba, with the alpha of an 8 digit colour and an extra opacity", () => {
    expect(cssColor("#FF8000")).toBe("rgba(255, 128, 0, 1)");
    expect(cssColor("#FF800080")).toBe("rgba(255, 128, 0, 0.502)");
    expect(cssColor("#FF8000", 0.5)).toBe("rgba(255, 128, 0, 0.5)");
  });
  it("picks a readable number colour for a counter", () => {
    expect(contrastColor("#EF4444")).toBe("#FFFFFF");
    expect(contrastColor("#FDE047")).toBe("#000000");
    expect(contrastColor("#000000")).toBe("#FFFFFF");
  });
  it("shrinks counter digits so more of them fit", () => {
    expect(counterFontSize(20, 1)).toBeGreaterThan(counterFontSize(20, 2));
    expect(counterFontSize(20, 2)).toBeGreaterThan(counterFontSize(20, 3));
  });
});

describe("arrow shape", () => {
  const base = { from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, width: 4 };
  it("has a head whose tip is the end point and a shaft that stops inside the head", () => {
    const shape = arrowShape({ ...base, style: "straight" });
    expect(shape.heads).toHaveLength(1);
    const [h] = shape.heads;
    expect(h?.tip).toEqual({ x: 100, y: 0 });
    expect(headLength(4, 100, false)).toBe(16);
    expect(h?.left).toEqual({ x: 84, y: 8 });
    expect(h?.right).toEqual({ x: 84, y: -8 });
    expect(shape.shaft.to.x).toBeCloseTo(100 - 16 * 0.8);
    expect(shape.shaft.control).toBeNull();
    expect(shape.outlined).toBe(false);
  });
  it("gives double arrows a head at each end and outlined ones an outline", () => {
    const double = arrowShape({ ...base, style: "double" });
    expect(double.heads.map((h) => h.tip)).toEqual([
      { x: 100, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(double.shaft.from.x).toBeGreaterThan(0);
    expect(arrowShape({ ...base, style: "outlined" }).outlined).toBe(true);
  });
  it("makes the head smaller on a short arrow and never below the minimum on a long one", () => {
    expect(headLength(4, 20, false)).toBe(10);
    expect(headLength(4, 30, true)).toBe(10);
    expect(headLength(1, 500, false)).toBe(12);
    expect(headLength(10, 500, false)).toBe(40);
  });
  it("points a curved arrow's head along the tangent at its end", () => {
    const shape = arrowShape({ ...base, style: "curved", curve: { x: 100, y: 50 } });
    expect(shape.shaft.control).toEqual({ x: 100, y: 50 });
    // The control point is below the end, so the curve arrives from below: the head points up and its base is below the tip.
    const [h] = shape.heads;
    expect(h?.left.y).toBeGreaterThan(0);
    expect(Math.abs((h?.left.x ?? 0) + (h?.right.x ?? 0) - 200)).toBeLessThan(1e-9);
  });
  it("does not break on a zero-length arrow", () => {
    const shape = arrowShape({
      from: { x: 5, y: 5 },
      to: { x: 5, y: 5 },
      style: "straight",
      width: 2,
    });
    expect(Number.isFinite(shape.heads[0]?.left.x)).toBe(true);
  });
});

describe("text layout", () => {
  it("keeps explicit line breaks and does not wrap without a width", () => {
    const layout = layoutText(input("one two three\nfour", null), mono);
    expect(layout.lines.map((l) => l.text)).toEqual(["one two three", "four"]);
    expect(layout.width).toBe(130);
    expect(layout.height).toBeCloseTo(2 * 20 * 1.3);
  });
  it("wraps at spaces inside a width", () => {
    const layout = layoutText(input("one two three", 80), mono);
    expect(layout.lines.map((l) => l.text)).toEqual(["one two", "three"]);
    expect(layout.width).toBe(80);
  });
  it("cuts a word that is wider than the block by characters", () => {
    const layout = layoutText(input("abcdefghij", 40), mono);
    expect(layout.lines.map((l) => l.text)).toEqual(["abcd", "efgh", "ij"]);
  });
  it("aligns each line inside the block", () => {
    const text = "aaaa\nbb";
    const at = (align: string) =>
      layoutText(input(text, null, align), mono).lines.map((l) => l.offset);
    expect(at("left")).toEqual([0, 0]);
    expect(at("center")).toEqual([0, 10]);
    expect(at("right")).toEqual([0, 20]);
  });
  it("has one empty line for empty text", () => {
    const layout = layoutText(input("", null), mono);
    expect(layout.lines).toHaveLength(1);
    expect(layout.width).toBe(0);
  });
  it("maps font ids to the bundled families and falls back to the default", () => {
    expect(fontFamily("inter")).toContain("Inter Variable");
    expect(fontFamily("jetbrains-mono")).toContain("JetBrains Mono");
    expect(fontFamily("comic-sans")).toBe(fontFamily("inter"));
    expect(fontString("inter", 600, 24)).toMatch(/^600 24px /);
  });
});

describe("pencil smoothing", () => {
  const zigzag = [0, 10, 0, 10, 0].map((y, i) => ({ x: i * 10, y }));
  it("leaves points alone at 0 and keeps the ends fixed at any strength", () => {
    expect(smoothPoints(zigzag, 0)).toEqual(zigzag);
    const smooth = smoothPoints(zigzag, 1);
    expect(smooth[0]).toEqual(zigzag[0]);
    expect(smooth[4]).toEqual(zigzag[4]);
  });
  it("flattens a zigzag more the stronger it is", () => {
    const range = (pts: { y: number }[]) =>
      Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y));
    expect(range(smoothPoints(zigzag, 0.5))).toBeLessThan(range(zigzag));
    expect(range(smoothPoints(zigzag, 1))).toBeLessThan(range(smoothPoints(zigzag, 0.5)));
  });
  it("does not change the input and copes with one or two points", () => {
    const copy = structuredClone(zigzag);
    smoothPoints(zigzag, 1);
    expect(zigzag).toEqual(copy);
    expect(smoothPoints([{ x: 1, y: 2 }], 1)).toEqual([{ x: 1, y: 2 }]);
    expect(smoothPoints([], 1)).toEqual([]);
  });
});
