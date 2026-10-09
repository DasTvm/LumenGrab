import { describe, expect, it } from "vitest";
import { formatKey, spokenShortcut } from "./keys";

describe("formatKey", () => {
  it("uses symbols on macOS and words elsewhere", () => {
    expect(formatKey("Ctrl", "macos")).toBe("⌃");
    expect(formatKey("Shift", "macos")).toBe("⇧");
    expect(formatKey("Ctrl", "windows")).toBe("Ctrl");
    expect(formatKey("Shift", "windows")).toBe("Shift");
  });

  it("leaves ordinary keys alone", () => {
    expect(formatKey("4", "macos")).toBe("4");
    expect(formatKey("4", "windows")).toBe("4");
  });
});

describe("spokenShortcut", () => {
  it("reads Ctrl as Control", () => {
    expect(spokenShortcut(["Ctrl", "Shift", "4"])).toBe("Control Shift 4");
  });
});
