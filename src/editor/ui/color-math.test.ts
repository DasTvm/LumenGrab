import { describe, expect, it } from "vitest";
import { hexToHsv, hexToRgb, hsvToHex, hueColor, parseHex, rgbToHex } from "./color-math";

describe("colour maths", () => {
  it("reads what people type", () => {
    expect(parseHex("#ef4444")).toBe("#EF4444");
    expect(parseHex("EF4444")).toBe("#EF4444");
    expect(parseHex("  #f00 ")).toBe("#FF0000");
    expect(parseHex("#12345678")).toBe("#123456");
    for (const bad of ["", "#12", "#12345", "red", "#GGGGGG", "#1234567"])
      expect(parseHex(bad), bad).toBeNull();
  });

  it("converts hex and rgb both ways", () => {
    expect(hexToRgb("#C8FF2E")).toEqual({ r: 200, g: 255, b: 46 });
    expect(rgbToHex({ r: 200, g: 255, b: 46 })).toBe("#C8FF2E");
    expect(rgbToHex({ r: -5, g: 300, b: 127.6 })).toBe("#00FF80");
    expect(hexToRgb("nonsense")).toEqual({ r: 0, g: 0, b: 0 });
  });

  it("knows the corners of the colour square", () => {
    expect(hexToHsv("#FF0000")).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv("#000000")).toEqual({ h: 0, s: 0, v: 0 });
    expect(hexToHsv("#FFFFFF")).toEqual({ h: 0, s: 0, v: 1 });
    expect(hexToHsv("#00FF00").h).toBe(120);
    expect(hexToHsv("#0000FF").h).toBe(240);
    expect(hueColor(60)).toBe("#FFFF00");
    expect(hueColor(300)).toBe("#FF00FF");
  });

  it("round-trips every palette colour of the design", () => {
    for (const hex of [
      "#EF4444",
      "#F97316",
      "#FACC15",
      "#C8FF2E",
      "#16A34A",
      "#2563EB",
      "#18181B",
      "#71717A",
      "#F472B6",
      "#38BDF8",
      "#4ADE80",
    ]) {
      expect(hsvToHex(hexToHsv(hex)), hex).toBe(hex);
    }
  });
});
