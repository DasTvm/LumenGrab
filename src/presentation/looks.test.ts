import { describe, expect, it } from "vitest";
import { defaultPresentation } from "@/document/write";
import {
  socialById,
  aspectOfSocial,
  aspectLabel,
  describeAspect,
  parseRatio,
  ratioLabel,
  socialGroups,
  aspectOfBasic,
  BASIC_ASPECTS,
  aspectOfCustom,
} from "./aspect-presets";
import {
  addStop,
  averageColor,
  colorAtOffset,
  convertBackground,
  resizeMesh,
  reverseStops,
  shadowTint,
  shuffleGradient,
  shuffleMesh,
} from "./backgrounds";
import {
  applyLook,
  BUILTIN_LOOKS,
  lengthScale,
  lookFromPresentation,
  lookMatches,
  partsFor,
} from "./looks";

describe("looks", () => {
  const base = defaultPresentation();

  it("applies only the parts a look has and switches the presentation on", () => {
    const midnight = BUILTIN_LOOKS[0];
    if (!midnight) throw new Error("no look");
    const next = applyLook({ ...base, cornerRadius: 33 }, midnight, 1280);
    expect(next.enabled).toBe(true);
    expect(next.background).toEqual(midnight.parts.background);
    expect(next.cornerRadius).toBe(33);
    expect(lookMatches(next, midnight, 1280)).toBe(true);
    expect(
      lookMatches({ ...next, background: { type: "solid", color: "#FFFFFF" } }, midnight, 1280),
    ).toBe(false);
    expect(lookMatches({ ...next, enabled: false }, midnight, 1280)).toBe(false);
  });

  it("has six built-in looks with distinct names and a background each", () => {
    expect(BUILTIN_LOOKS.map((l) => l.name)).toEqual([
      "Midnight",
      "Citrus",
      "Paper",
      "Sunset",
      "Ocean",
      "Aurora",
    ]);
    for (const look of BUILTIN_LOOKS) expect(look.parts.background).toBeDefined();
  });

  it("saves the chosen parts at the reference width and scales them to the picture it is applied to", () => {
    const current = {
      ...base,
      padding: { top: 128, right: 128, bottom: 128, left: 128 },
      cornerRadius: 40,
      shadow: { enabled: true, x: 0, y: 40, blur: 100, spread: 0, color: "#00000040" },
      frame: { type: "macos-window" as const },
    };
    const look = lookFromPresentation(
      current,
      ["padding", "cornerRadius", "shadow"],
      2560,
      "Mine",
      "l1",
    );
    expect(look.parts.padding?.top).toBe(64);
    expect(look.parts.cornerRadius).toBe(20);
    expect(look.parts.shadow?.blur).toBe(50);
    expect(look.parts.frame).toBeUndefined();
    expect(partsFor(look, 640).padding?.top).toBe(32);
    expect(partsFor(look, 2560).padding?.top).toBe(128);
    const applied = applyLook(base, look, 2560);
    expect(applied.padding.top).toBe(128);
    expect(applied.autoBalance).toBe(true);
    expect(lengthScale(100000)).toBe(4);
    expect(lengthScale(10)).toBe(0.25);
  });

  it("turns auto-balance off when a look has uneven padding", () => {
    const look = {
      id: "u",
      name: "Uneven",
      parts: { padding: { top: 10, right: 20, bottom: 30, left: 40 } },
    };
    expect(applyLook(base, look, 1280).autoBalance).toBe(false);
  });
});

describe("background helpers", () => {
  it("converts between types starting from what is there", () => {
    const solid = convertBackground({ type: "solid", color: "#112233" }, "gradient", 1);
    expect(solid.type).toBe("gradient");
    const gradient = convertBackground(
      {
        type: "gradient",
        angle: 0,
        stops: [
          { offset: 0, color: "#FF0000" },
          { offset: 1, color: "#0000FF" },
        ],
      },
      "solid",
      1,
    );
    expect(gradient).toEqual({ type: "solid", color: "#FF0000" });
    const mesh = convertBackground(gradient, "mesh", 5);
    expect(mesh.type === "mesh" && mesh.colors).toHaveLength(9);
    expect(convertBackground(mesh, "source-blur", 1).type).toBe("source-blur");
    expect(convertBackground(mesh, "image", 1, "a.png")).toMatchObject({
      type: "image",
      asset: "a.png",
      fit: "cover",
    });
  });

  it("shuffles deterministically and resizes the mesh", () => {
    const mesh = {
      type: "mesh" as const,
      seed: 1,
      colors: ["#111111", "#222222", "#333333", "#444444"],
      points: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as [number, number][],
    };
    const a = shuffleMesh(mesh, 9);
    expect(shuffleMesh(mesh, 9)).toEqual(a);
    expect([...a.colors].sort()).toEqual([...mesh.colors].sort());
    expect("points" in a).toBe(false);
    expect(resizeMesh(mesh, 3).colors).toHaveLength(9);
    expect(resizeMesh(mesh, 4).colors).toHaveLength(16);
    const g = shuffleGradient({ type: "gradient", angle: 0, stops: [] }, 4);
    expect(g.stops.length).toBeGreaterThanOrEqual(2);
  });

  it("reverses and adds gradient stops", () => {
    const g = {
      type: "gradient" as const,
      angle: 0,
      stops: [
        { offset: 0, color: "#FF0000" },
        { offset: 0.25, color: "#00FF00" },
        { offset: 1, color: "#0000FF" },
      ],
    };
    expect(reverseStops(g).stops).toEqual([
      { offset: 0, color: "#0000FF" },
      { offset: 0.75, color: "#00FF00" },
      { offset: 1, color: "#FF0000" },
    ]);
    const added = addStop(g.stops, 0);
    expect(added.stops).toHaveLength(4);
    expect(added.stops[added.index]?.offset).toBe(0.13);
  });

  it("reads a gradient's colour at any offset", () => {
    const stops = [
      { offset: 0, color: "#000000" },
      { offset: 1, color: "#FFFFFF" },
    ];
    expect(colorAtOffset(stops, 0.5)).toBe("#808080");
    expect(colorAtOffset(stops, -1)).toBe("#000000");
    expect(colorAtOffset(stops, 2)).toBe("#FFFFFF");
  });

  it("derives a darker shadow colour from the background", () => {
    expect(averageColor(["#FF0000", "#0000FF"])).toBe("#800080");
    const tint = shadowTint({ type: "solid", color: "#FF0000" }, 0.25);
    expect(tint).toMatch(/^#[0-9A-F]{6}40$/);
    expect(parseInt(tint.slice(1, 3), 16)).toBeLessThan(120);
  });
});

describe("aspect presets", () => {
  it("describes what the aspect setting is", () => {
    expect(describeAspect({ mode: "free" })).toEqual({ kind: "basic", id: "auto" });
    expect(
      describeAspect(
        aspectOfBasic(
          BASIC_ASPECTS.find((b) => b.id === "16:9") ?? { id: "x", label: "x", ratio: null },
        ),
      ),
    ).toEqual({ kind: "basic", id: "16:9" });
    expect(describeAspect(aspectOfCustom(7, 3))).toEqual({ kind: "basic", id: "custom" });
    const story = socialById("instagram-story");
    if (!story) throw new Error("no story preset");
    const aspect = aspectOfSocial(story);
    expect(aspect).toMatchObject({ size: [1080, 1920], preset: "instagram-story" });
    expect(describeAspect(aspect)).toMatchObject({ kind: "social" });
    expect(aspectLabel(aspect)).toBe("Instagram · Story / Reel");
    expect(aspectLabel({ mode: "fixed", ratio: [16, 9] })).toBe("16:9");
    expect(aspectLabel({ mode: "free" })).toBe("Auto");
  });

  it("groups the social presets by platform in the order of the design", () => {
    expect(socialGroups().map((g) => [g.platform, g.presets.length])).toEqual([
      ["Instagram", 3],
      ["TikTok", 1],
      ["X", 2],
      ["LinkedIn", 2],
      ["Facebook", 2],
      ["YouTube", 1],
      ["Pinterest", 1],
      ["Web", 2],
    ]);
  });

  it("names a size by its reduced ratio, or by a decimal", () => {
    expect(ratioLabel(1080, 1350)).toBe("4:5");
    expect(ratioLabel(1080, 1920)).toBe("9:16");
    expect(ratioLabel(1080, 1080)).toBe("1:1");
    expect(ratioLabel(1200, 627)).toBe("1.91:1");
    expect(ratioLabel(1500, 500)).toBe("3:1");
  });

  it("parses typed ratios", () => {
    expect(parseRatio("16:9")).toEqual([16, 9]);
    expect(parseRatio(" 1,91 / 1 ")).toEqual([1.91, 1]);
    expect(parseRatio("0:5")).toBeNull();
    expect(parseRatio("abc")).toBeNull();
  });
});

describe("shadow presets", () => {
  const shadow = { enabled: true, x: 0, y: 20, blur: 40, spread: 0, color: "#000000" };
  it("detects a preset and scales it with the picture", async () => {
    const { applyShadowPreset, detectShadowPreset, shadowOpacity, withOpacity } =
      await import("./shadow-presets");
    const medium = applyShadowPreset(shadow, "medium", 1280);
    expect(medium).toMatchObject({ y: 20, blur: 40 });
    expect(shadowOpacity(medium)).toBeCloseTo(0.25, 2);
    expect(detectShadowPreset(medium, 1280)).toBe("medium");
    expect(detectShadowPreset({ ...medium, blur: 41 }, 1280)).toBe("custom");
    const big = applyShadowPreset(shadow, "medium", 2560);
    expect(big.blur).toBe(80);
    expect(detectShadowPreset(big, 2560)).toBe("medium");
    expect(detectShadowPreset(big, 1280)).toBe("custom");
    expect(withOpacity("#112233FF", 0.5)).toBe("#11223380");
  });
});
