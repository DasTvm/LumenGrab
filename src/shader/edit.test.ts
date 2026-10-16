import { describe, expect, it } from "vitest";
import {
  addCustom,
  addLayer,
  canAddLayer,
  duplicateLayer,
  isDefault,
  moveLayer,
  patchLayer,
  randomColours,
  randomize,
  removeLayer,
  resetParams,
  sceneProblem,
  setPalette,
  setParam,
} from "./edit";
import { newScene } from "./scene";
import { TEMPLATES } from "./scenes";

const base = () => TEMPLATES[0]?.make() ?? newScene();
const ids = (scene: ReturnType<typeof base>) => scene.layers.map((l) => l.id);

describe("editing a scene", () => {
  it("adds a layer on top with its defaults, and says no when the stack is full", () => {
    const made = addLayer(newScene(), "aurora", "a");
    expect(made?.id).toBe("a");
    expect(made?.scene.layers[0]).toMatchObject({
      kind: "aurora",
      enabled: true,
      opacity: 1,
      blend: "normal",
      speed: 2,
    });
    expect(made?.scene.layers[0]?.params).toMatchObject({ scale: 1.2, rotation: 35 });
    expect(addLayer(newScene(), "no-such-kind")).toBeNull();
    let full = newScene();
    for (let i = 0; i < 16; i += 1) full = addLayer(full, "solid", `s${String(i)}`)?.scene ?? full;
    expect(full.layers).toHaveLength(16);
    expect(canAddLayer(full)).toBe(false);
    expect(addLayer(full, "solid")).toBeNull();
    expect(duplicateLayer(full, "s0")).toBeNull();
  });

  it("leaves the old scene alone", () => {
    const scene = base();
    const before = JSON.stringify(scene);
    removeLayer(scene, ids(scene)[0] ?? "");
    patchLayer(scene, ids(scene)[0] ?? "", { opacity: 0.1 });
    setParam(scene, ids(scene)[0] ?? "", "angle", 5);
    moveLayer(scene, ids(scene)[0] ?? "", 3);
    expect(JSON.stringify(scene)).toBe(before);
  });

  it("removes, duplicates right above the original, and moves", () => {
    const scene = base();
    const [a, b, c, d, e] = ids(scene);
    expect(ids(removeLayer(scene, c ?? ""))).toEqual([a, b, d, e]);
    const copy = duplicateLayer(scene, b ?? "", "copy");
    expect(ids(copy?.scene ?? scene)).toEqual([a, b, "copy", c, d, e]);
    expect(ids(moveLayer(scene, a ?? "", 4))).toEqual([b, c, d, e, a]);
    expect(ids(moveLayer(scene, e ?? "", 0))).toEqual([e, a, b, c, d]);
    expect(ids(moveLayer(scene, "nope", 0))).toEqual(ids(scene));
  });

  it("changes a setting of one layer only", () => {
    const scene = base();
    const id = scene.layers[2]?.id ?? "";
    const next = setParam(scene, id, "scale", 3);
    expect(next.layers[2]?.params["scale"]).toBe(3);
    expect(next.layers[3]?.params).toEqual(scene.layers[3]?.params);
  });

  it("resets one section or all settings to their defaults", () => {
    const scene = base();
    const aurora = scene.layers.find((l) => l.kind === "aurora");
    if (!aurora) throw new Error("aurora");
    const changed = setParam(setParam(scene, aurora.id, "scale", 3), aurora.id, "source", "custom");
    const layer = changed.layers.find((l) => l.id === aurora.id);
    expect(layer && isDefault(layer, "scale")).toBe(false);
    const shapeOnly = resetParams(changed, aurora.id, "Shape").layers.find(
      (l) => l.id === aurora.id,
    );
    expect(shapeOnly?.params["scale"]).toBe(1.2);
    expect(shapeOnly?.params["source"]).toBe("custom");
    const all = resetParams(changed, aurora.id).layers.find((l) => l.id === aurora.id);
    expect(all?.params["source"]).toBe("palette");
  });

  it("adds a layer with code", () => {
    const made = addCustom(newScene(), "effect", "Wobble", "void main(){}", { amount: 0.5 }, "w");
    expect(made?.scene.layers[0]).toMatchObject({
      kind: "custom",
      role: "effect",
      name: "Wobble",
      code: "void main(){}",
      params: { amount: 0.5 },
    });
  });

  it("keeps the palette between one and eight colours", () => {
    const scene = base();
    expect(setPalette(scene, ["#111111"]).palette).toEqual(["#111111"]);
    expect(setPalette(scene, []).palette).toEqual(scene.palette);
    expect(
      setPalette(
        scene,
        Array.from({ length: 12 }, () => "#222222"),
      ).palette,
    ).toHaveLength(8);
  });

  it("randomizes the seed and the colours the same way every time for one seed", () => {
    const scene = base();
    const a = randomize(scene, 7);
    const b = randomize(scene, 7);
    expect(a).toEqual(b);
    expect(a.seed).toBe(7);
    expect(a.palette).toHaveLength(6);
    expect(a.layers).toEqual(scene.layers);
    expect(randomColours(7)).toHaveLength(6);
  });

  it("names what stops a scene from being used", () => {
    expect(sceneProblem(base())).toBeNull();
    const big =
      addCustom(newScene(), "generator", "x", "x".repeat(16000), {}, "a")?.scene ?? newScene();
    const more = {
      ...big,
      layers: Array.from({ length: 5 }, (_, i) => ({
        ...(big.layers[0] ?? {}),
        id: `c${String(i)}`,
      })) as typeof big.layers,
    };
    expect(sceneProblem(more)).toBe("too much code");
  });
});
