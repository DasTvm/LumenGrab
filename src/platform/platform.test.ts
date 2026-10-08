import { beforeEach, describe, expect, it } from "vitest";
import { platform } from "@/platform";

describe("platform (outside Tauri)", () => {
  beforeEach(() => {
    // vitest runs in node: provide the bits of `window` the mock touches.
    (globalThis as { window?: unknown }).window = { location: { search: "?mode=window" } };
  });

  it("resolves to the browser mock", async () => {
    const info = await platform.getAppInfo();
    expect(info.runtime).toBe("browser-mock");
  });

  it("returns a frozen frame with pixel dimensions and, in window mode, windows front to back", async () => {
    const s = await platform.getOverlaySession("mock", 1);
    expect(s.mode).toBe("window");
    expect(s.frameUrl).not.toBe("");
    expect(s.display.pixelWidth).toBeGreaterThan(0);
    expect(s.display.pixelHeight).toBeGreaterThan(0);
    expect(s.windows.length).toBeGreaterThan(1);
    for (const w of s.windows) {
      expect(w.x + w.width).toBeLessThanOrEqual(s.display.pixelWidth);
      expect(w.y + w.height).toBeLessThanOrEqual(s.display.pixelHeight);
    }
  });

  it("records what the overlay submits so browser tests can assert on it", async () => {
    await platform.submitArea("mock", 1, { x: 1, y: 2, width: 3, height: 4 });
    await platform.cancelCapture("mock");
    const log = (
      globalThis as { window: { __lumengrabMock?: { submissions: { kind: string }[] } } }
    ).window.__lumengrabMock;
    expect(log?.submissions.map((s) => s.kind)).toEqual(["area", "cancel"]);
  });
});
