import { describe, expect, it } from "vitest";
import { ProjectSchema, ShaderBackgroundSchema } from "@/document/schema";
import {
  aiBrief,
  assembleCustom,
  checkCustomCode,
  customValues,
  EXAMPLES,
  labelFromName,
  parseCompileLog,
  parsePragmas,
} from "./custom";
import { KIND_SHADERS, helperPrelude } from "./glsl";
import { EFFECTS, GENERATORS, KINDS, kindById, kindFragment, uniformsOf } from "./kinds";
import { formatNumber, normalizeStops, readParam, resolveParams } from "./params";
import {
  layerColors,
  layerTime,
  newCustomLayer,
  newLayer,
  newScene,
  paddedPalette,
  paletteUse,
  phaseAt,
  posterSeconds,
  sceneMoves,
} from "./scene";
import { ANIMATED_LOOKS, TEMPLATES } from "./scenes";
import { builtinValues, compositeValues, customLayerValues } from "./uniforms";

describe("the registry", () => {
  it("has a shader for every kind, and a unique id and uniform name for every setting", () => {
    for (const kind of KINDS) {
      expect(KIND_SHADERS[kind.id], kind.id).toBeDefined();
      const ids = kind.specs.map((s) => s.id);
      expect(new Set(ids).size, kind.id).toBe(ids.length);
      expect(kindFragment(kind)).toContain("void main()");
      for (const { name } of uniformsOf(kind)) expect(kindFragment(kind)).toContain(name);
    }
    expect(GENERATORS.length + EFFECTS.length).toBe(KINDS.length);
    expect(new Set(KINDS.map((k) => k.id)).size).toBe(KINDS.length);
  });

  it("has defaults inside every range", () => {
    for (const kind of KINDS) {
      for (const spec of kind.specs) {
        if (spec.type === "number" || spec.type === "int") {
          expect(spec.default, `${kind.id}.${spec.id}`).toBeGreaterThanOrEqual(spec.min);
          expect(spec.default, `${kind.id}.${spec.id}`).toBeLessThanOrEqual(spec.max);
        }
      }
    }
  });

  it("builds the same shader text every time", () => {
    const aurora = kindById("aurora");
    expect(aurora && kindFragment(aurora)).toBe(aurora && kindFragment(aurora));
  });
});

describe("settings", () => {
  const scale = kindById("aurora")?.specs[0];
  it("clamp numbers into their range and fall back to the default for anything else", () => {
    if (!scale) throw new Error("spec");
    expect(readParam(scale, 99)).toBe(4);
    expect(readParam(scale, -3)).toBe(0.3);
    expect(readParam(scale, "x")).toBe(1.2);
    expect(readParam(scale, undefined)).toBe(1.2);
    expect(readParam(scale, Number.NaN)).toBe(1.2);
  });

  it("keep the stops sorted, between two and eight, and replace broken lists", () => {
    const fallback = [
      { offset: 0, color: "#000000" },
      { offset: 1, color: "#FFFFFF" },
    ];
    expect(normalizeStops("nope", fallback)).toBe(fallback);
    expect(normalizeStops([{ offset: 0.5, color: "#111111" }], fallback)).toBe(fallback);
    const sorted = normalizeStops(
      [
        { offset: 0.9, color: "#111111" },
        { offset: 0.1, color: "#222222" },
        { offset: 7, color: "bad" },
      ],
      fallback,
    );
    expect(sorted.map((s) => s.offset)).toEqual([0.1, 0.9]);
    const many = Array.from({ length: 12 }, (_, i) => ({ offset: i / 11, color: "#123456" }));
    expect(normalizeStops(many, fallback)).toHaveLength(8);
  });

  it("fill in what a file leaves out and ignore what it adds", () => {
    const kind = kindById("orbs");
    if (!kind) throw new Error("kind");
    const resolved = resolveParams(kind.specs, { count: 99, strangeNew: 5 });
    expect(resolved["count"]).toBe(12);
    expect(resolved["softness"]).toBe(0.6);
    expect(resolved).not.toHaveProperty("strangeNew");
  });

  it("are written the way the Studio shows them", () => {
    const grade = kindById("grade");
    const contrast = grade?.specs.find((s) => s.id === "contrast");
    const sat = grade?.specs.find((s) => s.id === "saturation");
    if (contrast?.type !== "int" || sat?.type !== "number") throw new Error("spec");
    expect(formatNumber(contrast, 12)).toBe("+12");
    expect(formatNumber(contrast, -4)).toBe("-4");
    expect(formatNumber(sat, 1.1)).toBe("110%");
    const aurora = kindById("aurora")?.specs;
    const rotation = aurora?.find((s) => s.id === "rotation");
    if (rotation?.type !== "number") throw new Error("spec");
    expect(formatNumber(rotation, 35)).toBe("35°");
  });
});

describe("time", () => {
  const scene = newScene({ loop: 8 });
  it("wraps into the loop and keeps the still frame inside it", () => {
    expect(phaseAt(scene, 0)).toBe(0);
    expect(phaseAt(scene, 4)).toBe(0.5);
    expect(phaseAt(scene, 8)).toBe(0);
    expect(phaseAt(scene, 10)).toBe(0.25);
    expect(phaseAt(scene, -2)).toBe(0.75);
    expect(posterSeconds({ ...scene, poster: 99 })).toBeLessThan(8);
    expect(posterSeconds({ ...scene, poster: 2.5 })).toBe(2.5);
  });

  it("gives every layer whole turns per loop, so the end is the start", () => {
    const kind = kindById("aurora");
    if (!kind) throw new Error("kind");
    for (const speed of [0, 1, 2, 5]) {
      const layer = { ...newLayer(kind), speed };
      const start = layerTime(layer, 0);
      const almostEnd = layerTime(layer, 1 - 1e-9);
      expect(Math.cos(almostEnd.a)).toBeCloseTo(Math.cos(start.a), 6);
      expect(Math.sin(almostEnd.a)).toBeCloseTo(Math.sin(start.a), 6);
      expect(almostEnd.ph + 1e-6).toBeGreaterThan(speed === 0 ? 0 : 0.99);
    }
    const back = layerTime({ ...newLayer(kind), speed: 1, reverse: true }, 0.25);
    expect(back.a).toBeCloseTo(-Math.PI / 2, 9);
    expect(back.ph).toBeCloseTo(0.75, 9);
  });

  it("knows whether a scene moves", () => {
    const aurora = kindById("aurora");
    const vignette = kindById("vignette");
    if (!aurora || !vignette) throw new Error("kinds");
    expect(sceneMoves({ ...scene, layers: [] })).toBe(false);
    expect(sceneMoves({ ...scene, layers: [newLayer(aurora)] })).toBe(true);
    expect(sceneMoves({ ...scene, layers: [{ ...newLayer(aurora), speed: 0 }] })).toBe(false);
    expect(sceneMoves({ ...scene, layers: [{ ...newLayer(aurora), enabled: false }] })).toBe(false);
    expect(sceneMoves({ ...scene, layers: [{ ...newLayer(vignette), speed: 3 }] })).toBe(false);
    const still = newCustomLayer("generator", "Still", "void main(){ gl_FragColor = vec4(1.0); }");
    expect(sceneMoves({ ...scene, layers: [still] })).toBe(false);
    const moving = newCustomLayer(
      "generator",
      "Moving",
      "uniform float u_phase;\nvoid main(){ gl_FragColor = vec4(u_phase); }",
    );
    expect(sceneMoves({ ...scene, layers: [moving] })).toBe(true);
  });
});

describe("colours", () => {
  const scene = newScene({ palette: ["#111111", "#222222", "#333333", "#444444"] });
  const aurora = kindById("aurora");
  const orbs = kindById("orbs");
  if (!aurora || !orbs) throw new Error("kinds");

  it("give a layer its share of the palette", () => {
    expect(layerColors(scene, newLayer(aurora), aurora)).toEqual(["#111111", "#222222", "#333333"]);
    expect(layerColors(scene, newLayer(orbs), orbs)).toEqual(scene.palette);
    expect(layerColors({ ...scene, palette: ["#111111"] }, newLayer(aurora), aurora)).toEqual([
      "#111111",
    ]);
  });

  it("swap the last colour for the highlight when the source is custom", () => {
    const layer = { ...newLayer(aurora), params: { source: "custom", highlight: "#C8FF2E" } };
    expect(layerColors(scene, layer, aurora)).toEqual(["#111111", "#222222", "#C8FF2E"]);
  });

  it("are padded to eight for the custom shaders, by repeating the palette", () => {
    const padded = paddedPalette(scene);
    expect(padded).toHaveLength(8);
    expect(padded.slice(4)).toEqual(scene.palette);
  });

  it("are described in words", () => {
    expect(paletteUse(aurora, 6)).toBe("Uses palette colours 1 to 3");
    expect(paletteUse(aurora, 2)).toBe("Uses palette colours 1 to 2");
    expect(paletteUse(aurora, 1)).toBe("Uses palette colour 1");
  });
});

describe("the numbers a pass receives", () => {
  const scene = newScene();
  it("carry the layer's settings as uniforms", () => {
    const kind = kindById("pixelate");
    if (!kind) throw new Error("kind");
    const layer = {
      ...newLayer(kind),
      speed: 2,
      params: { size: 20, square: false, amount: 0.5, animate: true },
    };
    const v = builtinValues(scene, layer, kind, 0.25, 1280, 720);
    expect(v["u_size"]).toBe(20);
    expect(v["u_square"]).toBe(0);
    expect(v["u_animate"]).toBe(1);
    expect(v["u_amount"]).toBe(0.5);
    expect(v["u_resolution"]).toEqual([1280, 720]);
    expect(v["u_unit"]).toBe(1);
    expect(v["u_a"]).toBeCloseTo(Math.PI, 9);
    expect(builtinValues(scene, layer, kind, 0, 2560, 1440)["u_unit"]).toBe(2);
  });

  it("carry gradient stops, padded to eight", () => {
    const kind = kindById("gradient");
    if (!kind) throw new Error("kind");
    const v = builtinValues(scene, newLayer(kind), kind, 0, 100, 100);
    expect(v["u_stopN"]).toBe(2);
    expect(v["u_stopOff"]).toHaveLength(8);
    expect(v["u_stopCol"]).toHaveLength(32);
  });

  it("carry the settings of a layer with code by name", () => {
    const layer = newCustomLayer("generator", "Stars", EXAMPLES[2]?.code ?? "", {
      density: 9,
      star: "#FF0000",
    });
    const v = customLayerValues(scene, layer, 0.5, 200, 100);
    expect(v["density"]).toBe(1);
    expect(v["star"]).toEqual([1, 0, 0]);
    expect(v["twinkle"]).toBe(0.6);
    expect(v["u_phase"]).toBe(0.5);
    expect(v["u_palette"]).toHaveLength(24);
  });

  it("say how a layer is laid over the picture below", () => {
    const kind = kindById("warp");
    if (!kind) throw new Error("kind");
    const layer = { ...newLayer(kind), opacity: 0.4, blend: "screen" as const };
    expect(compositeValues(layer, true, 10, 10)).toMatchObject({
      u_opacity: 0.4,
      u_mode: 2,
      u_opaque: 1,
    });
    expect(compositeValues(layer, false, 10, 10)["u_opaque"]).toBe(0);
  });
});

describe("the scenes that ship", () => {
  it("fit the file format, with a unique id for every layer", () => {
    const all = [...TEMPLATES.map((t) => t.make()), ...ANIMATED_LOOKS.map((l) => l.make())];
    expect(ANIMATED_LOOKS).toHaveLength(14);
    expect(TEMPLATES.map((t) => t.name)).toEqual([
      "Aurora night",
      "Soft orbs",
      "Ocean waves",
      "Liquid metal",
      "Neon rays",
      "Starfield",
      "Blank",
    ]);
    for (const scene of all) {
      expect(ShaderBackgroundSchema.safeParse(scene).success).toBe(true);
      const ids = scene.layers.map((l) => l.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const layer of scene.layers) expect(kindById(layer.kind)).toBeDefined();
    }
  });

  it("are the same every time", () => {
    expect(JSON.stringify(TEMPLATES[0]?.make())).toBe(JSON.stringify(TEMPLATES[0]?.make()));
  });
});

describe("the file format", () => {
  const base = {
    version: 4,
    crop: null,
    layers: [],
    presentation: {
      enabled: true,
      background: newScene({
        layers: [newLayer(kindById("aurora") ?? KINDS[0] ?? (undefined as never))],
      }),
      padding: { top: 1, right: 1, bottom: 1, left: 1 },
      autoBalance: true,
      cornerRadius: 0,
      shadow: { enabled: false, x: 0, y: 0, blur: 0, spread: 0, color: "#00000000" },
      frame: { type: "none" },
      aspect: { mode: "free" },
      exportScale: 1,
    },
  };
  it("accepts a shader background and keeps what it does not know", () => {
    const scene = {
      ...newScene(),
      futureField: 1,
      layers: [
        { ...newLayer(kindById("aurora") ?? KINDS[0] ?? (undefined as never)), strange: [1, 2] },
      ],
    };
    const parsed = ShaderBackgroundSchema.parse(scene) as Record<string, unknown>;
    expect(parsed["futureField"]).toBe(1);
    expect((parsed["layers"] as Record<string, unknown>[])[0]?.["strange"]).toEqual([1, 2]);
    expect(ProjectSchema.safeParse(base).success).toBe(true);
  });

  it("rejects numbers that cannot be right", () => {
    const aurora = kindById("aurora");
    if (!aurora) throw new Error("kind");
    const layer = newLayer(aurora);
    expect(ShaderBackgroundSchema.safeParse({ ...newScene(), loop: 0 }).success).toBe(false);
    expect(ShaderBackgroundSchema.safeParse({ ...newScene(), loop: 61 }).success).toBe(false);
    expect(ShaderBackgroundSchema.safeParse({ ...newScene(), palette: [] }).success).toBe(false);
    expect(
      ShaderBackgroundSchema.safeParse({ ...newScene(), palette: Array(9).fill("#000000") })
        .success,
    ).toBe(false);
    expect(
      ShaderBackgroundSchema.safeParse({ ...newScene(), layers: Array(17).fill(layer) }).success,
    ).toBe(false);
    expect(
      ShaderBackgroundSchema.safeParse({ ...newScene(), layers: [{ ...layer, speed: 1.5 }] })
        .success,
    ).toBe(false);
    expect(
      ShaderBackgroundSchema.safeParse({ ...newScene(), layers: [{ ...layer, opacity: 2 }] })
        .success,
    ).toBe(false);
    expect(
      ShaderBackgroundSchema.safeParse({ ...newScene(), layers: [{ ...layer, blend: "dissolve" }] })
        .success,
    ).toBe(false);
  });

  it("limits the code of one layer and of the whole background", () => {
    const ok = newCustomLayer("generator", "A", "x".repeat(16384));
    const tooLong = newCustomLayer("generator", "B", "x".repeat(16385));
    expect(ShaderBackgroundSchema.safeParse({ ...newScene(), layers: [ok] }).success).toBe(true);
    expect(ShaderBackgroundSchema.safeParse({ ...newScene(), layers: [tooLong] }).success).toBe(
      false,
    );
    const five = Array.from({ length: 5 }, (_, i) => ({ ...ok, id: `c${String(i)}` }));
    expect(ShaderBackgroundSchema.safeParse({ ...newScene(), layers: five }).success).toBe(false);
  });
});

describe("code you write", () => {
  it("finds its settings in the comments, with ranges and labels", () => {
    const { params, problems } = parsePragmas(
      [
        "// @param float speed = 1.0 [0.0, 4.0]",
        "// @param color tint = #c8ff2e",
        '// @param bool soft = true "Soft edges"',
        "// @param int count = 3 [1, 8]",
        "// @param float loose = 5",
      ].join("\n"),
    );
    expect(problems).toEqual([]);
    expect(params.map((p) => p.spec.id)).toEqual(["speed", "tint", "soft", "count", "loose"]);
    expect(params[0]?.spec).toMatchObject({
      type: "number",
      min: 0,
      max: 4,
      default: 1,
      label: "Speed",
    });
    expect(params[1]?.spec).toMatchObject({ type: "color", default: "#C8FF2E" });
    expect(params[2]?.spec).toMatchObject({ type: "bool", default: true, label: "Soft edges" });
    expect(params[3]?.spec).toMatchObject({ type: "int", min: 1, max: 8, default: 3 });
    expect(params[4]?.spec).toMatchObject({ min: 0, max: 10, default: 5 });
    expect(params[0]?.line).toBe(1);
  });

  it("reports a setting it cannot read instead of guessing", () => {
    const { params, problems } = parsePragmas(
      [
        "// @param float a = oops",
        "// @param float u_phase = 1.0",
        "// @param bool b = maybe",
        "// @param color c = red",
        "// @param float d = 1.0",
        "// @param float d = 2.0",
        "// @param vec3 e = 1",
      ].join("\n"),
    );
    expect(params.map((p) => p.spec.id)).toEqual(["d"]);
    expect(problems.map((p) => p.line)).toEqual([1, 2, 3, 4, 6, 7]);
  });

  it("makes labels from names", () => {
    expect(labelFromName("soft")).toBe("Soft");
    expect(labelFromName("softEdges")).toBe("Soft edges");
    expect(labelFromName("tint_color")).toBe("Tint color");
  });

  it("is checked before it is compiled", () => {
    expect(checkCustomCode(EXAMPLES[0]?.code ?? "")).toEqual({ ok: true });
    expect(checkCustomCode("x".repeat(16385))).toMatchObject({ ok: false, kind: "too-long" });
    expect(
      checkCustomCode("#extension GL_OES_foo : enable\nvoid main(){ gl_FragColor = vec4(1.0); }"),
    ).toMatchObject({
      ok: false,
      line: 1,
    });
    expect(
      checkCustomCode("#version 300 es\nvoid main(){ gl_FragColor = vec4(1.0); }"),
    ).toMatchObject({ ok: false });
    expect(
      checkCustomCode("void main(){ for (int i = 0; i < 5000; i++) {} gl_FragColor = vec4(1.0); }"),
    ).toMatchObject({
      ok: false,
    });
    expect(
      checkCustomCode("void main(){ for (int i = 0; i < 64; i++) {} gl_FragColor = vec4(1.0); }"),
    ).toEqual({ ok: true });
    expect(checkCustomCode("void other() {}")).toMatchObject({ ok: false });
    expect(checkCustomCode("void main() {}")).toMatchObject({ ok: false });
  });

  it("keeps the lines of the code when it is compiled", () => {
    const code = "// one\nvoid main() { gl_FragColor = vec4(1.0); }";
    const text = assembleCustom(code);
    const lines = text.split("\n");
    const at = lines.indexOf("#line 1");
    expect(lines[at + 1]).toBe("// one");
    expect(lines[at + 2]).toContain("void main()");
  });

  it("brings its own helpers unless the code has them", () => {
    expect(helperPrelude("void main(){}")).toContain("float noise(vec2 p)");
    expect(helperPrelude("float noise(vec2 p) { return 1.0; }\nvoid main(){}")).not.toContain(
      "float noise(vec2 p) {",
    );
    expect(helperPrelude("mat2 rot(float a) { return mat2(1.0); }")).not.toContain(
      "mat2 rot(float a) {",
    );
    expect(helperPrelude("")).toContain("float fbm(vec2 p)");
  });

  it("turns a compiler message into a line and a text", () => {
    expect(
      parseCompileLog("ERROR: 0:15: 'sinn' : no matching overloaded function found\n"),
    ).toEqual({
      line: 15,
      message: "'sinn' : no matching overloaded function found",
    });
    expect(parseCompileLog("").line).toBeNull();
    expect(parseCompileLog("something odd").message).toBe("something odd");
  });

  it("takes the values of its settings from the file when they fit", () => {
    const specs = parsePragmas(EXAMPLES[0]?.code ?? "").params.map((p) => p.spec);
    expect(customValues(specs, { speed: 2, tint: "bad" })).toMatchObject({ speed: 2, soft: true });
    expect(customValues(specs, { speed: 100 })["speed"]).toBe(4);
  });

  it("ships examples that pass the checks and declare their settings", () => {
    expect(EXAMPLES.map((e) => e.name)).toEqual([
      "Plasma",
      "Soft clouds",
      "Starfield",
      "Light sweep",
      "Chromatic wobble",
      "Pixel melt",
      "Blank generator",
      "Blank effect",
    ]);
    for (const example of EXAMPLES) {
      expect(checkCustomCode(example.code), example.id).toEqual({ ok: true });
      const { params, problems } = parsePragmas(example.code);
      expect(problems, example.id).toEqual([]);
      if (params.length > 0) expect(example.code).toContain(`uniform`);
      for (const { spec } of params) expect(example.code).toContain(spec.id);
      expect(example.code.length).toBeLessThan(2000);
      expect(example.role === "effect").toBe(example.code.includes("u_input"));
    }
  });

  it("explains the rules to an AI, with the code and an example when asked", () => {
    const brief = aiBrief({ code: "void main(){}", example: "// ex" });
    expect(brief).toContain("GLSL ES 1.00");
    expect(brief).toContain("MY REQUEST");
    expect(brief).toContain("u_phase");
    expect(brief).toContain("MY CURRENT CODE\nvoid main(){}");
    expect(brief).toContain("A WORKING EXAMPLE\n// ex");
    expect(aiBrief({})).not.toContain("MY CURRENT CODE");
  });
});
