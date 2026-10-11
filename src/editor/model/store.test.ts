import { describe, expect, it } from "vitest";
import type { GroupLayer, Layer } from "@/document/schema";
import { counterIds, group, ids, projectWith, rect } from "./test-layers";
import { allIds } from "./tree";
import { createEditorStore } from "./store";

const make = (layers: Layer[] = [], maxHistory?: number) =>
  createEditorStore(projectWith(layers), {
    makeId: counterIds("new"),
    ...(maxHistory ? { maxHistory } : {}),
  });

describe("history", () => {
  it("undoes and redoes a change, with the selection that went with it", () => {
    const store = make();
    store.getState().addLayer(rect("a"));
    expect(store.getState().selection).toEqual(["a"]);
    store.getState().select([]);
    store.getState().addLayer(rect("b"));
    expect(ids(store.getState().project.layers)).toEqual(["a", "b"]);

    store.getState().undo();
    expect(ids(store.getState().project.layers)).toEqual(["a"]);
    expect(store.getState().selection).toEqual([]); // as before "b" was added
    store.getState().undo();
    expect(store.getState().project.layers).toEqual([]);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);

    store.getState().redo();
    store.getState().redo();
    expect(ids(store.getState().project.layers)).toEqual(["a", "b"]);
    expect(store.getState().selection).toEqual(["b"]);
    expect(store.getState().canRedo).toBe(false);
  });

  it("drops the redo steps when something new happens", () => {
    const store = make();
    store.getState().addLayer(rect("a"));
    store.getState().undo();
    store.getState().addLayer(rect("b"));
    expect(store.getState().canRedo).toBe(false);
    store.getState().redo();
    expect(ids(store.getState().project.layers)).toEqual(["b"]);
  });

  it("makes a whole drag one undo step", () => {
    const store = make([rect("a", 0, 0)]);
    store.getState().beginGesture();
    for (let i = 1; i <= 20; i += 1) {
      store.getState().change((p) => {
        (p.layers[0] as { x: number }).x = i;
      });
    }
    store.getState().endGesture();
    expect((store.getState().project.layers[0] as { x: number }).x).toBe(20);
    store.getState().undo();
    expect((store.getState().project.layers[0] as { x: number }).x).toBe(0);
    expect(store.getState().canUndo).toBe(false);
    store.getState().redo();
    expect((store.getState().project.layers[0] as { x: number }).x).toBe(20);
  });

  it("undoes a gesture that changed several things in the right order", () => {
    const store = make([rect("a", 0, 0)]);
    store.getState().beginGesture();
    store.getState().change((p) => {
      (p.layers[0] as { x: number }).x = 5;
    });
    store.getState().change((p) => {
      (p.layers[0] as { x: number }).x = 9;
      p.layers.push(rect("b"));
    });
    store.getState().endGesture();
    store.getState().undo();
    expect(store.getState().project.layers).toEqual([rect("a", 0, 0)]);
  });

  it("cancels a gesture (Esc) without a trace in the history", () => {
    const store = make([rect("a", 0, 0)]);
    store.getState().beginGesture();
    store.getState().change((p) => {
      (p.layers[0] as { x: number }).x = 50;
    });
    expect(store.getState().dirty).toBe(true);
    store.getState().cancelGesture();
    expect((store.getState().project.layers[0] as { x: number }).x).toBe(0);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().dirty).toBe(false);
  });

  it("an empty gesture and a change that changes nothing leave no step", () => {
    const store = make([rect("a")]);
    store.getState().beginGesture();
    store.getState().endGesture();
    store.getState().change(() => undefined);
    store.getState().change((p) => {
      (p.layers[0] as { x: number }).x = 0; // already 0
    });
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().dirty).toBe(false);
  });

  it("keeps the last 200 steps", () => {
    const store = make([rect("a", 0, 0)]);
    for (let i = 1; i <= 250; i += 1) {
      store.getState().change((p) => {
        (p.layers[0] as { x: number }).x = i;
      });
    }
    let undone = 0;
    while (store.getState().canUndo) {
      store.getState().undo();
      undone += 1;
    }
    expect(undone).toBe(200);
    expect((store.getState().project.layers[0] as { x: number }).x).toBe(50);
  });

  it("does not change the project it was given", () => {
    const project = projectWith([rect("a", 0, 0)]);
    const copy = structuredClone(project);
    const store = createEditorStore(project);
    store.getState().nudge(5, 5, ["a"]);
    expect(project).toEqual(copy);
  });
});

describe("dirty flag", () => {
  it("is set by a change, cleared by markSaved, and follows undo and redo", () => {
    const store = make();
    expect(store.getState().dirty).toBe(false);
    store.getState().addLayer(rect("a"));
    expect(store.getState().dirty).toBe(true);
    store.getState().markSaved();
    expect(store.getState().dirty).toBe(false);
    store.getState().addLayer(rect("b"));
    expect(store.getState().dirty).toBe(true);
    store.getState().undo();
    expect(store.getState().dirty).toBe(false); // back at the saved state
    store.getState().undo();
    expect(store.getState().dirty).toBe(true);
    store.getState().redo();
    expect(store.getState().dirty).toBe(false);
  });

  it("stays dirty when the saved state can no longer be reached", () => {
    const store = make();
    store.getState().addLayer(rect("a"));
    store.getState().markSaved();
    store.getState().undo();
    store.getState().addLayer(rect("b")); // the saved state was redone away
    store.getState().undo();
    store.getState().addLayer(rect("a"));
    expect(store.getState().dirty).toBe(true);
  });
});

describe("layer commands", () => {
  it("duplicates layers (groups with new ids inside), offset and selected", () => {
    const store = make([rect("a", 0, 0), group("g", [rect("b", 5, 5)])]);
    store.getState().duplicateLayers(["g"]);
    const layers = store.getState().project.layers;
    expect(layers).toHaveLength(3);
    const copy = layers[2] as GroupLayer;
    expect(allIds([copy])).toEqual(["new1", "new2"]); // the group first, then its child
    expect(new Set(allIds(layers)).size).toBe(allIds(layers).length); // all ids unique
    expect((copy.layers[0] as { x: number }).x).toBe(17);
    expect(store.getState().selection).toEqual([copy.id]);
    store.getState().undo();
    expect(store.getState().project.layers).toHaveLength(2);
  });

  it("deletes the selection, but not locked layers or layers inside a locked group", () => {
    const store = make([
      rect("a"),
      { ...rect("b"), locked: true },
      group("g", [rect("c")], { locked: true }),
    ]);
    store.getState().select(["a", "b", "g"]);
    store.getState().deleteLayers();
    expect(ids(store.getState().project.layers)).toEqual(["b", "g"]);
    store.getState().deleteLayers(["c"]);
    expect(allIds(store.getState().project.layers)).toEqual(["b", "g", "c"]);
  });

  it("nudges unlocked layers in one step", () => {
    const store = make([rect("a", 0, 0), { ...rect("b", 0, 0), locked: true }]);
    store.getState().nudge(3, 4, ["a", "b"]);
    const [a, b] = store.getState().project.layers as unknown as { x: number; y: number }[];
    expect([a?.x, a?.y, b?.x, b?.y]).toEqual([3, 4, 0, 0]);
    store.getState().undo();
    expect((store.getState().project.layers[0] as { x: number }).x).toBe(0);
  });

  it("groups and ungroups with selection and undo", () => {
    const store = make([rect("a"), rect("b"), rect("c")]);
    store.getState().group(["a", "c"]);
    expect(store.getState().selection).toEqual(["new1"]);
    expect(allIds(store.getState().project.layers)).toEqual(["b", "new1", "a", "c"]);
    store.getState().ungroup(["new1"]);
    expect(ids(store.getState().project.layers)).toEqual(["b", "a", "c"]);
    expect(store.getState().selection).toEqual(["a", "c"]);
    store.getState().undo();
    expect(allIds(store.getState().project.layers)).toEqual(["b", "new1", "a", "c"]);
    expect(store.getState().selection).toEqual(["new1"]);
  });

  it("a grouping that is not possible changes nothing", () => {
    const store = make([rect("a")]);
    store.getState().select(["a"]);
    store.getState().group([]);
    store.getState().group(["nope"]);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().selection).toEqual(["a"]);
  });

  it("reorders, moves into a group, renames, hides and locks", () => {
    const store = make([rect("a"), rect("b"), group("g", [])]);
    store.getState().reorder("front", ["a"]);
    expect(ids(store.getState().project.layers)).toEqual(["b", "g", "a"]);
    store.getState().reorder("backward", ["a"]);
    expect(ids(store.getState().project.layers)).toEqual(["b", "a", "g"]);
    store.getState().moveTo(["a"], "g");
    expect(allIds(store.getState().project.layers)).toEqual(["b", "g", "a"]);
    store.getState().rename("a", "  Title box ");
    store.getState().setVisible("a", false);
    store.getState().setLocked("a", true);
    const a = (store.getState().project.layers[1] as GroupLayer).layers[0];
    expect(a).toMatchObject({ name: "Title box", visible: false, locked: true });
    store.getState().rename("a", "");
    expect((store.getState().project.layers[1] as GroupLayer).layers[0]).not.toHaveProperty("name");
  });
});
