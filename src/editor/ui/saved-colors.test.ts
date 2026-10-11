// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";

/** A tiny localStorage and window for Node (the list logic does not need a browser). */
const store = new Map<string, string>();
const listeners = new Set<() => void>();
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    },
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    dispatchEvent: () => {
      listeners.forEach((l) => {
        l();
      });
      return true;
    },
  },
  Event: class {
    constructor(public type: string) {}
  },
});

const { getSavedColors, MAX_SAVED_COLORS, parseSaved, removeSavedColor, saveColor } =
  await import("./saved-colors");

beforeEach(() => {
  store.clear();
});

describe("saved colours", () => {
  it("keeps a colour, newest first, once, in capitals", () => {
    saveColor("#abcdef");
    saveColor("#123456");
    saveColor("#ABCDEF");
    expect(getSavedColors()).toEqual(["#ABCDEF", "#123456"]);
  });

  it("ignores what is not a colour and removes by value", () => {
    saveColor("red");
    expect(getSavedColors()).toEqual([]);
    saveColor("#fff");
    saveColor("#000");
    removeSavedColor("#FFFFFF");
    expect(getSavedColors()).toEqual(["#000000"]);
  });

  it("holds at most 24 and drops the oldest", () => {
    for (let i = 0; i < MAX_SAVED_COLORS + 5; i += 1)
      saveColor(`#${i.toString(16).padStart(6, "0")}`);
    const list = getSavedColors();
    expect(list).toHaveLength(MAX_SAVED_COLORS);
    expect(list[0]).toBe(`#${(MAX_SAVED_COLORS + 4).toString(16).padStart(6, "0").toUpperCase()}`);
  });

  it("survives a damaged value and gives the same list object while nothing changed", () => {
    expect(parseSaved("{not json")).toEqual([]);
    expect(parseSaved('{"a":1}')).toEqual([]);
    expect(parseSaved('["#fff", 5, null, "#FFF", "nope", "#123456"]')).toEqual([
      "#FFFFFF",
      "#123456",
    ]);
    store.set("lumengrab.savedColors", "garbage");
    expect(getSavedColors()).toBe(getSavedColors());
    expect(getSavedColors()).toEqual([]);
  });
});
