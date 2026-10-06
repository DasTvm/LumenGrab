import { describe, expect, it } from "vitest";
import { platform } from "@/platform";

describe("platform (outside Tauri)", () => {
  it("resolves to the browser mock", async () => {
    const info = await platform.getAppInfo();
    expect(info.runtime).toBe("browser-mock");
  });

  it("returns a fake capture with source-pixel dimensions", async () => {
    const result = await platform.capture("fullscreen");
    expect(result.imageUrl).not.toBe("");
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.scale).toBeGreaterThanOrEqual(1);
  });
});
