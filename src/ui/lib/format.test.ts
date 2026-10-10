import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("uses decimal units like Finder and Explorer", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1 KB");
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(12_345)).toBe("12 KB");
    expect(formatBytes(1_234_567)).toBe("1.2 MB");
    expect(formatBytes(125_000_000)).toBe("125 MB");
    expect(formatBytes(2_500_000_000)).toBe("2.5 GB");
  });

  it("rolls over at the unit boundary instead of showing 1000 KB", () => {
    expect(formatBytes(999_960)).toBe("1 MB");
  });

  it("shows nothing for nonsense", () => {
    expect(formatBytes(-1)).toBe("");
    expect(formatBytes(Number.NaN)).toBe("");
  });
});
