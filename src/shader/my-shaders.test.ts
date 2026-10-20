import { describe, expect, it } from "vitest";
import { detectRole, EXAMPLES } from "./custom";
import {
  createShadersStore,
  parseShaders,
  parseTrusted,
  uniqueShaderName,
  type ShadersBackend,
} from "./my-shaders";

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

  it("keeps what the editor writes: a new shader, then the changes of that same one", async () => {
    const { api, saved } = backend();
    let n = 0;
    const store = createShadersStore(api, () => `id${String((n += 1))}`);
    await store.getState().init();
    const glow = await store
      .getState()
      .keepShader({ name: "Glow", role: "generator", code, values: {} });
    const other = await store
      .getState()
      .keepShader({ name: "glow", role: "generator", code, values: {} });
    expect([glow.name, other.name]).toEqual(["Glow", "glow 2"]);
    const changed = await store
      .getState()
      .keepShader(
        { name: "Glow", role: "generator", code: `${code}\n`, values: { a: 1 } },
        glow.id,
      );
    expect(changed).toMatchObject({ id: glow.id, name: "Glow", values: { a: 1 } });
    expect(store.getState().shaders).toHaveLength(2);
    expect(parseShaders(saved["my-shaders"] ?? null).shaders.map((x) => x.name)).toEqual([
      "Glow",
      "glow 2",
    ]);
    // Renaming one to the name of the other gets a free name instead of taking it.
    const renamed = await store
      .getState()
      .keepShader({ name: "GLOW 2", role: "generator", code, values: {} }, glow.id);
    expect(renamed.name).toBe("GLOW 2 2");
  });

  it("duplicates a shader under a free name", async () => {
    const { api } = backend();
    const store = createShadersStore(
      api,
      (() => {
        let n = 0;
        return () => `id${String((n += 1))}`;
      })(),
    );
    const glow = await store
      .getState()
      .keepShader({ name: "Glow", role: "effect", code, values: { a: 2 } });
    const copy = await store.getState().duplicateShader(glow.id);
    const second = await store.getState().duplicateShader(glow.id);
    expect([copy?.name, second?.name]).toEqual(["Glow copy", "Glow copy 2"]);
    expect(copy).toMatchObject({ role: "effect", values: { a: 2 } });
    expect(await store.getState().duplicateShader("nope")).toBeNull();
  });

  it("picks a free name", () => {
    const list = [
      { id: "1", name: "Glow", role: "generator" as const, code, values: {} },
      { id: "2", name: "Glow 2", role: "generator" as const, code, values: {} },
    ];
    expect(uniqueShaderName(list, "Wobble")).toBe("Wobble");
    expect(uniqueShaderName(list, " glow ")).toBe("glow 3");
    expect(uniqueShaderName(list, "Glow", "1")).toBe("Glow");
    expect(uniqueShaderName(list, "")).toBe("Untitled shader");
    expect(uniqueShaderName(list, "x".repeat(60)).length).toBeLessThanOrEqual(40);
  });

  it("reads what a shader is from its code", () => {
    expect(detectRole("void main() { gl_FragColor = vec4(1.0); }")).toBe("generator");
    expect(detectRole("uniform sampler2D u_input;\nvoid main() {}")).toBe("effect");
    expect(detectRole("// uses u_input later\nvoid main() {}")).toBe("generator");
    expect(EXAMPLES.every((e) => detectRole(e.code) === e.role)).toBe(true);
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
