import { describe, expect, it } from "vitest";
import { patchLayer, setParam } from "@/shader/edit";
import { TEMPLATES } from "@/shader/scenes";
import { createStudioStore, isDirty } from "./studio-store";

const make = () =>
  createStudioStore(TEMPLATES[0]?.make() ?? (undefined as never), { name: "Test" });

describe("the Studio's own history", () => {
  it("starts on the top layer, at the still frame, and is not dirty", () => {
    const store = make();
    const s = store.getState();
    expect(s.selected).toBe(s.scene.layers.at(-1)?.id);
    expect(s.time).toBe(s.scene.poster);
    expect(isDirty(s)).toBe(false);
  });

  it("makes one undo step per change, and redo goes forward again", () => {
    const store = make();
    const id = store.getState().scene.layers[0]?.id ?? "";
    store.getState().change((s) => patchLayer(s, id, { opacity: 0.5 }));
    store.getState().change((s) => patchLayer(s, id, { opacity: 0.2 }));
    expect(isDirty(store.getState())).toBe(true);
    store.getState().undo();
    expect(store.getState().scene.layers[0]?.opacity).toBe(0.5);
    store.getState().undo();
    expect(isDirty(store.getState())).toBe(false);
    store.getState().redo();
    expect(store.getState().scene.layers[0]?.opacity).toBe(0.5);
    // A new change throws the redo list away.
    store.getState().change((s) => patchLayer(s, id, { opacity: 0.9 }));
    store.getState().redo();
    expect(store.getState().scene.layers[0]?.opacity).toBe(0.9);
  });

  it("a gesture (a slider drag) is one step, and one that changed nothing leaves none", () => {
    const store = make();
    const id = store.getState().scene.layers[0]?.id ?? "";
    store.getState().begin();
    for (const v of [1, 2, 3]) store.getState().change((s) => setParam(s, id, "angle", v));
    store.getState().end();
    expect(store.getState().past).toHaveLength(1);
    store.getState().begin();
    store.getState().end();
    expect(store.getState().past).toHaveLength(1);
    store.getState().undo();
    expect(isDirty(store.getState())).toBe(false);
  });

  it("forgets a selection that undo took away", () => {
    const store = make();
    const before = store.getState().scene;
    store.getState().change((s) => ({
      ...s,
      layers: [...s.layers, { ...before.layers[0], id: "extra" } as never],
    }));
    store.getState().select("extra");
    store.getState().undo();
    expect(store.getState().selected).toBeNull();
  });

  it("replaces the whole scene with a template as one step", () => {
    const store = make();
    const template = TEMPLATES[5]?.make();
    if (!template) throw new Error("template");
    store.getState().replaceScene(template);
    expect(store.getState().scene).toEqual(template);
    expect(store.getState().solo).toBeNull();
    store.getState().undo();
    expect(isDirty(store.getState())).toBe(false);
  });

  it("keeps at most a hundred steps", () => {
    const store = make();
    const id = store.getState().scene.layers[0]?.id ?? "";
    for (let i = 0; i < 130; i += 1)
      store.getState().change((s) => patchLayer(s, id, { opacity: i / 200 }));
    expect(store.getState().past.length).toBe(100);
  });
});
