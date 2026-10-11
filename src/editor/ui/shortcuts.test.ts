import { describe, expect, it } from "vitest";
import { commandForKey, type KeyInfo } from "./shortcuts";

const key = (k: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({
  key: k,
  code: "",
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  ...extra,
});

describe("shortcuts", () => {
  it("undoes and redoes with the command key of the platform", () => {
    expect(commandForKey(key("z", { metaKey: true }), true)).toEqual({ type: "undo" });
    expect(commandForKey(key("z", { metaKey: true, shiftKey: true }), true)).toEqual({
      type: "redo",
    });
    expect(commandForKey(key("z", { ctrlKey: true }), false)).toEqual({ type: "undo" });
    expect(commandForKey(key("y", { ctrlKey: true }), false)).toEqual({ type: "redo" });
    expect(commandForKey(key("y", { metaKey: true }), true)).toBeNull(); // not a Mac shortcut
    expect(commandForKey(key("z", { ctrlKey: true }), true)).toBeNull(); // Ctrl is not the command key on a Mac
  });

  it("knows the shortcuts of the layers menu", () => {
    const mac = (k: string, extra: Partial<KeyInfo> = {}) =>
      commandForKey(key(k, { metaKey: true, ...extra }), true);
    expect(mac("d")).toEqual({ type: "duplicate" });
    expect(mac("g")).toEqual({ type: "group" });
    expect(mac("g", { shiftKey: true })).toEqual({ type: "ungroup" });
    expect(mac("]", { code: "BracketRight", shiftKey: true })).toEqual({ type: "front" });
    expect(mac("[", { code: "BracketLeft", shiftKey: true })).toEqual({ type: "back" });
    expect(mac("]", { code: "BracketRight" })).toEqual({ type: "forward" });
    expect(mac("[", { code: "BracketLeft" })).toEqual({ type: "backward" });
    expect(commandForKey(key("Delete"), true)).toEqual({ type: "delete" });
    expect(commandForKey(key("Backspace"), true)).toEqual({ type: "delete" });
  });

  it("picks tools by letter, but not with a modifier", () => {
    expect(commandForKey(key("a"), true)).toEqual({ type: "tool", tool: "arrow" });
    expect(commandForKey(key("R"), true)).toEqual({ type: "tool", tool: "rect" });
    expect(commandForKey(key("b"), true)).toEqual({ type: "tool", tool: "redact" });
    expect(commandForKey(key("v"), true)).toEqual({ type: "tool", tool: "select" });
    expect(commandForKey(key("c"), true)).toEqual({ type: "tool", tool: "crop" });
    expect(commandForKey(key("a", { shiftKey: true }), true)).toBeNull();
    expect(commandForKey(key("a", { altKey: true }), true)).toBeNull();
    expect(commandForKey(key("q"), true)).toBeNull();
  });

  it("nudges by one pixel, ten with shift", () => {
    expect(commandForKey(key("ArrowLeft"), true)).toEqual({ type: "nudge", dx: -1, dy: 0 });
    expect(commandForKey(key("ArrowDown", { shiftKey: true }), true)).toEqual({
      type: "nudge",
      dx: 0,
      dy: 10,
    });
  });

  it("saves, exports, zooms", () => {
    expect(commandForKey(key("s", { ctrlKey: true }), false)).toEqual({ type: "save" });
    expect(commandForKey(key("s", { ctrlKey: true, shiftKey: true }), false)).toEqual({
      type: "saveAs",
    });
    expect(commandForKey(key("0", { ctrlKey: true }), false)).toEqual({ type: "fit" });
    expect(commandForKey(key("1", { ctrlKey: true }), false)).toEqual({ type: "zoom100" });
    expect(commandForKey(key("=", { ctrlKey: true }), false)).toEqual({ type: "zoomIn" });
    expect(commandForKey(key("-", { ctrlKey: true }), false)).toEqual({ type: "zoomOut" });
    expect(commandForKey(key("Escape"), false)).toEqual({ type: "deselect" });
  });
});
