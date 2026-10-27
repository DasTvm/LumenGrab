import { describe, expect, it } from "vitest";
import { halvings } from "./smooth";

describe("halvings", () => {
  it("draws a picture as it is while it stays above half its size", () => {
    expect(halvings(1000, 1000)).toBe(0);
    expect(halvings(1000, 600)).toBe(0);
    expect(halvings(1000, 500)).toBe(1);
  });

  it("halves a 5K screenshot until the last step is below a factor of two", () => {
    // 5120 px shown 1200 px wide: 5120 -> 2560 -> 1280, then bilinear does the last 1.07x.
    expect(halvings(5120, 1200)).toBe(2);
    expect(halvings(5120, 700)).toBe(2);
    expect(halvings(5120, 300)).toBe(4);
  });

  it("makes no steps for sizes that make no sense", () => {
    expect(halvings(0, 100)).toBe(0);
    expect(halvings(100, 0)).toBe(0);
    expect(halvings(Number.NaN, 100)).toBe(0);
  });
});
