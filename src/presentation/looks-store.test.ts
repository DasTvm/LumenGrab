import { describe, expect, it } from "vitest";
import { BUILTIN_LOOKS } from "./looks";
import {
  assetsOfLooks,
  createLooksStore,
  isBuiltinName,
  parseLooks,
  serializeLooks,
  type LooksBackend,
} from "./looks-store";

function memory(initial: string | null = null) {
  const state = {
    json: initial,
    assets: new Map<string, Uint8Array>(),
    saves: 0,
    listeners: [] as (() => void)[],
  };
  const backend: LooksBackend = {
    load: () => Promise.resolve(state.json),
    save: (json) => {
      state.json = json;
      state.saves += 1;
      return Promise.resolve();
    },
    readAsset: (name) => Promise.resolve(state.assets.get(name) ?? null),
    writeAsset: (name, bytes) => {
      state.assets.set(name, bytes);
      return Promise.resolve();
    },
    pruneAssets: (keep) => {
      for (const name of [...state.assets.keys()])
        if (!keep.includes(name)) state.assets.delete(name);
      return Promise.resolve();
    },
    onChanged: (listener) => {
      state.listeners.push(listener);
      return Promise.resolve(() => undefined);
    },
  };
  return { state, backend };
}

const parts = { cornerRadius: 20, background: { type: "solid" as const, color: "#112233" } };
let n = 0;
const ids = () => `id${String((n += 1))}`;

describe("looks file", () => {
  it("reads valid looks, drops broken ones one by one and survives garbage", () => {
    const good = { id: "a", name: "Docs", parts };
    const file = parseLooks(
      JSON.stringify({
        version: 1,
        looks: [
          good,
          { id: "b", name: "", parts },
          { id: "c", name: "Bad", parts: { cornerRadius: -5 } },
          good,
          "x",
        ],
        defaultLook: { id: "d", name: "Def", parts },
      }),
    );
    expect(file.looks).toEqual([good]);
    expect(file.defaultLook?.name).toBe("Def");
    expect(parseLooks("not json")).toEqual({ version: 1, looks: [], defaultLook: null });
    expect(parseLooks(null).looks).toEqual([]);
    expect(parseLooks("[]").looks).toEqual([]);
    expect(
      parseLooks(serializeLooks({ version: 1, looks: [good], defaultLook: null })).looks,
    ).toEqual([good]);
  });

  it("lists the pictures the looks and the default use", () => {
    const image = { type: "image" as const, asset: `${"a".repeat(64)}.png`, fit: "cover" as const };
    expect(
      assetsOfLooks({
        version: 1,
        looks: [{ id: "1", name: "A", parts: { background: image } }],
        defaultLook: {
          id: "2",
          name: "B",
          parts: { background: { ...image, asset: `${"b".repeat(64)}.jpg` } },
        },
      }),
    ).toEqual([`${"a".repeat(64)}.png`, `${"b".repeat(64)}.jpg`]);
  });

  it("knows the built-in names", () => {
    expect(isBuiltinName(" midnight ")).toBe(true);
    expect(isBuiltinName("Client demo")).toBe(false);
    expect(BUILTIN_LOOKS.length).toBe(6);
  });
});

describe("looks store", () => {
  it("saves, renames, updates and removes looks and keeps them across a restart", async () => {
    const { backend, state } = memory();
    const store = createLooksStore(backend, ids);
    await store.getState().init();
    expect(store.getState().loaded).toBe(true);

    const saved = await store.getState().saveLook("  Client demo ", parts);
    expect(saved.status).toBe("saved");
    const id = saved.status === "saved" ? saved.look.id : "";
    expect(store.getState().looks.map((l) => l.name)).toEqual(["Client demo"]);

    await store.getState().renameLook(id, "Docs");
    await store.getState().updateLook(id, { cornerRadius: 8 });
    expect(store.getState().looks[0]).toMatchObject({ name: "Docs", parts: { cornerRadius: 8 } });

    const again = createLooksStore(backend, ids);
    await again.getState().init();
    expect(again.getState().looks).toEqual(store.getState().looks);

    const removed = await store.getState().removeLook(id);
    expect(store.getState().looks).toEqual([]);
    expect(removed?.index).toBe(0);
    if (removed) await store.getState().restoreLook(removed);
    expect(store.getState().looks).toHaveLength(1);
    expect(state.saves).toBe(5);
  });

  it("asks before it replaces a look with the same name, ignoring case", async () => {
    const store = createLooksStore(memory().backend, ids);
    await store.getState().init();
    await store.getState().saveLook("Docs", parts);
    const clash = await store.getState().saveLook("docs", { cornerRadius: 1 });
    expect(clash.status).toBe("exists");
    expect(store.getState().looks[0]?.parts).toEqual(parts);
    const replaced = await store
      .getState()
      .saveLook("docs", { cornerRadius: 1 }, { replace: true });
    expect(replaced.status).toBe("saved");
    expect(store.getState().looks).toHaveLength(1);
    expect(store.getState().looks[0]?.parts).toEqual({ cornerRadius: 1 });
  });

  it("copies the default look, so deleting the saved look does not change it", async () => {
    const store = createLooksStore(memory().backend, ids);
    await store.getState().init();
    const saved = await store.getState().saveLook("Docs", parts);
    if (saved.status !== "saved") throw new Error("not saved");
    await store.getState().setDefault(saved.look);
    await store.getState().removeLook(saved.look.id);
    expect(store.getState().defaultLook?.name).toBe("Docs");
    await store.getState().setDefault(null);
    expect(store.getState().defaultLook).toBeNull();
  });

  it("removes pictures no look uses any more and reports a save that failed", async () => {
    const { backend, state } = memory();
    const store = createLooksStore(backend, ids);
    await store.getState().init();
    const name = `${"c".repeat(64)}.png`;
    await store.getState().addAsset(name, Uint8Array.of(1));
    const saved = await store
      .getState()
      .saveLook("Pic", { background: { type: "image", asset: name, fit: "cover" } });
    expect(state.assets.has(name)).toBe(true);
    const removed =
      saved.status === "saved" ? await store.getState().removeLook(saved.look.id) : null;
    expect(state.assets.has(name)).toBe(false);
    // Undo brings the picture back with the look.
    if (removed) await store.getState().restoreLook(removed);
    expect(state.assets.has(name)).toBe(true);
    expect(store.getState().looks.map((l) => l.name)).toEqual(["Pic"]);

    const failing = createLooksStore(
      { ...backend, save: () => Promise.reject(new Error("disk full")) },
      ids,
    );
    await failing.getState().init();
    await failing.getState().saveLook("X", parts);
    expect(failing.getState().error).toBe("disk full");
    expect(failing.getState().looks.map((l) => l.name)).toEqual(["Pic", "X"]); // still usable in this session
  });

  it("reloads when another window changed the looks", async () => {
    const { backend, state } = memory();
    const store = createLooksStore(backend, ids);
    await store.getState().init();
    state.json = serializeLooks({
      version: 1,
      looks: [{ id: "z", name: "From elsewhere", parts }],
      defaultLook: null,
    });
    state.listeners.forEach((l) => {
      l();
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.getState().looks.map((l) => l.name)).toEqual(["From elsewhere"]);
  });
});
