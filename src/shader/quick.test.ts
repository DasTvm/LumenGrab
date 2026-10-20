import { describe, expect, it } from "vitest";
import { ShaderBackgroundSchema } from "@/document/schema";
import { setParam } from "./edit";
import {
  colourCount,
  FASTEST_LOOP,
  loopAt,
  quickSettings,
  SLOWEST_LOOP,
  speedPosition,
  withLoop,
} from "./quick";
import { ANIMATED_LOOKS } from "./scenes";
import { phaseAt } from "./scene";

const look = (id: string) => {
  const made = ANIMATED_LOOKS.find((l) => l.id === id)?.make();
  if (!made) throw new Error(`no look ${id}`);
  return made;
};

describe("the quick settings", () => {
  it("offer a few sliders for the first layer of each kind, generators first", () => {
    const sliders = quickSettings(look("animated-aurora"));
    expect(sliders.map((s) => s.label)).toEqual(["Scale", "Size", "Softness", "Vignette", "Grain"]);
    expect(sliders.length).toBeLessThanOrEqual(5);
  });

  it("read the value of the layer and change it without touching the old scene", () => {
    const scene = look("animated-silk");
    const flow = quickSettings(scene).find((s) => s.label === "Flow");
    expect(flow?.value).toBe(0.55);
    const next = setParam(scene, flow?.layerId ?? "", "warp", 1.2);
    expect(quickSettings(next).find((s) => s.label === "Flow")?.value).toBe(1.2);
    expect(quickSettings(scene).find((s) => s.label === "Flow")?.value).toBe(0.55);
  });

  it("skip a layer that is switched off", () => {
    const scene = look("animated-aurora");
    const off = {
      ...scene,
      layers: scene.layers.map((l) => (l.kind === "orbs" ? { ...l, enabled: false } : l)),
    };
    expect(quickSettings(off).map((s) => s.label)).not.toContain("Size");
  });

  it("count the palette colours the layers use", () => {
    expect(colourCount(look("animated-silk"))).toBe(4);
    expect(colourCount(look("animated-nebula"))).toBe(5);
    expect(colourCount({ ...look("animated-aurora"), layers: [] })).toBe(1);
  });
});

describe("the speed", () => {
  it("runs from the slowest to the fastest loop and back", () => {
    expect(loopAt(0)).toBe(SLOWEST_LOOP);
    expect(loopAt(1)).toBe(FASTEST_LOOP);
    expect(speedPosition(SLOWEST_LOOP)).toBeCloseTo(0);
    expect(speedPosition(FASTEST_LOOP)).toBeCloseTo(1);
    expect(speedPosition(8)).toBeCloseTo(speedPosition(loopAt(speedPosition(8))), 1);
    // Out-of-range loops sit at the ends of the slider.
    expect(speedPosition(2)).toBeCloseTo(1);
  });

  it("keeps the still frame on the same picture when the loop changes", () => {
    const scene = { ...look("animated-silk"), loop: 40, poster: 10 };
    const faster = withLoop(scene, 20);
    expect(faster.loop).toBe(20);
    expect(phaseAt(faster, faster.poster)).toBeCloseTo(phaseAt(scene, scene.poster), 1);
    expect(ShaderBackgroundSchema.safeParse(faster).success).toBe(true);
  });

  it("never leaves the still frame outside the loop", () => {
    const scene = { ...look("animated-silk"), loop: 60, poster: 59.9 };
    const faster = withLoop(scene, 6);
    expect(faster.poster).toBeLessThan(faster.loop);
  });
});
