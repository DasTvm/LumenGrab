import { describe, expect, it } from "vitest";
import { EXAMPLES } from "./custom";
import { createShadersStore, parseShaders, parseTrusted, type ShadersBackend } from "./my-shaders";

const code = EXAMPLES[0]?.code ?? "";

function backend(files: Record<string, string | null> = {}) {
  const saved: Record<string, string> = {};
  const api: ShadersBackend = {
    load: (name) => Promise.resolve(files[name] ?? null),
    save: (name, json) => {
      saved[name] = json;
      return Promise.resolve();
    },
    onChanged: () => Promise.resolve(() => undefined),
  };
  return { api, saved };
}

describe("My shaders", () => {
  it("reads the file leniently: broken entries go, the rest stays", () => {
    const good = { id: "a", name: "Glow", role: "generator", code, values: { speed: 1 } };
    const file = JSON.stringify({
      version: 1,
      shaders: [
        good,
        { ...good, id: "b", name: "" },
        { ...good, id: "c", role: "other" },
        {
          ...good,
          id: "d",
          code: "#extension GL_OES_foo : enable\nvoid main(){ gl_FragColor = vec4(1.0); }",
        },
        { ...good, id: "a" },
        "nonsense",
      ],
    });
    expect(parseShaders(file).shaders.map((s) => s.id)).toEqual(["a"]);
    expect(parseShaders("not json").shaders).toEqual([]);
    expect(parseShaders(null).shaders).toEqual([]);
    expect(parseShaders('{"shaders": 5}').shaders).toEqual([]);
  });

  it("reads the trusted documents", () => {
    expect(parseTrusted('{"documents":["a","b","a",3,""]}')).toEqual(["a", "b"]);
    expect(parseTrusted("{")).toEqual([]);
    expect(parseTrusted(null)).toEqual([]);
  });

  it("keeps a shader, refuses a taken name until it is replaced, and removes one", async () => {
    const { api, saved } = backend();
    let n = 0;
    const store = createShadersStore(api, () => `id${String((n += 1))}`);
    await store.getState().init();
    const first = await store
      .getState()
      .saveShader({ name: "Glow", role: "generator", code, values: {} });
    expect(first).toMatchObject({ status: "saved" });
    const again = await store
      .getState()
      .saveShader({ name: " glow ", role: "effect", code, values: {} });
    expect(again.status).toBe("exists");
    const replaced = await store
      .getState()
      .saveShader({ name: "glow", role: "effect", code, values: { a: 1 } }, { replace: true });
    expect(replaced).toMatchObject({ status: "saved", shader: { id: "id1", role: "effect" } });
    expect(store.getState().shaders).toHaveLength(1);
    expect(parseShaders(saved["my-shaders"] ?? null).shaders).toHaveLength(1);
    expect((await store.getState().removeShader("id1"))?.name).toBe("glow");
    expect(store.getState().shaders).toEqual([]);
    expect(await store.getState().removeShader("id1")).toBeNull();
  });

  it("remembers which documents may run their code, once", async () => {
    const { api, saved } = backend({ trusted: '{"documents":["old"]}' });
    const store = createShadersStore(api);
    await store.getState().init();
    expect(store.getState().trusted).toEqual(["old"]);
    await store.getState().trustDocument("new");
    await store.getState().trustDocument("new");
    expect(parseTrusted(saved["trusted"] ?? null)).toEqual(["old", "new"]);
  });

  it("tells when saving fails and keeps the shader in memory", async () => {
    const { api } = backend();
    api.save = () => Promise.reject(new Error("The folder is not writable."));
    const store = createShadersStore(api);
    await store.getState().saveShader({ name: "A", role: "generator", code, values: {} });
    expect(store.getState().error).toBe("The folder is not writable.");
    expect(store.getState().shaders).toHaveLength(1);
  });
});
