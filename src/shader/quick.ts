import { customValues, parsePragmas } from "./custom";
import { kindById } from "./kinds";
import { resolveParams, type NumberSpec, type ParamSpec } from "./params";
import type { ShaderScene } from "./types";

/**
 * The few settings of a background that are worth a slider without opening the Studio: how fast it moves,
 * which colours it uses, and the one or two things that matter for each kind of layer. Pure, tested in Node.
 */

export interface QuickSetting {
  layerId: string;
  spec: NumberSpec;
  /** The words on the slider (shorter and plainer than the Inspector's). */
  label: string;
  value: number;
}

/** What matters per kind: the setting and the words for it. Generators first, then effects. */
const QUICK: Record<string, { id: string; label: string }[]> = {
  orbs: [
    { id: "size", label: "Size" },
    { id: "softness", label: "Softness" },
  ],
  aurora: [{ id: "scale", label: "Scale" }],
  waves: [
    { id: "amplitude", label: "Height" },
    { id: "softness", label: "Softness" },
  ],
  liquid: [
    { id: "scale", label: "Scale" },
    { id: "warp", label: "Flow" },
  ],
  cells: [{ id: "scale", label: "Scale" }],
  ripples: [{ id: "spacing", label: "Spacing" }],
  pattern: [{ id: "scale", label: "Scale" }],
  rays: [
    { id: "spread", label: "Width" },
    { id: "falloff", label: "Falloff" },
  ],
  stars: [
    { id: "density", label: "Amount" },
    { id: "twinkle", label: "Twinkle" },
  ],
  vignette: [{ id: "amount", label: "Vignette" }],
  grain: [{ id: "amount", label: "Grain" }],
  glow: [{ id: "intensity", label: "Glow" }],
};

const MAX_GENERATOR_SLIDERS = 3;
const MAX_SLIDERS = 5;

/** The sliders for a scene: the first layer of each kind, generators before effects, at most five. */
export function quickSettings(scene: ShaderScene): QuickSetting[] {
  const seen = new Set<string>();
  const generators: QuickSetting[] = [];
  const effects: QuickSetting[] = [];
  for (const layer of scene.layers) {
    if (!layer.enabled || seen.has(layer.kind)) continue;
    const kind = kindById(layer.kind);
    const wanted = QUICK[layer.kind];
    if (!kind || !wanted) continue;
    seen.add(layer.kind);
    const resolved = resolveParams(kind.specs, layer.params);
    for (const { id, label } of wanted) {
      const spec = kind.specs.find((s) => s.id === id);
      const value = resolved[id];
      if (spec?.type !== "number" && spec?.type !== "int") continue;
      if (typeof value !== "number") continue;
      (kind.role === "generator" ? generators : effects).push({
        layerId: layer.id,
        spec,
        label,
        value,
      });
    }
  }
  const out = [...generators.slice(0, MAX_GENERATOR_SLIDERS), ...effects];
  return out.slice(0, MAX_SLIDERS);
}

/** Whether the code of a layer reads the palette at all (a shader of yours that has its own colours does not). */
const usesPalette = (code: string): boolean =>
  /\bu_palette\b/.test(code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""));

/** How many colours of the palette the scene's layers paint with (the rest would change nothing); 0 when none does. */
export function colourCount(scene: ShaderScene): number {
  const on = scene.layers.filter((l) => l.enabled);
  if (on.length === 0) return 1;
  let most = 0;
  for (const layer of on) {
    if (layer.kind === "custom") {
      if (usesPalette(layer.code ?? "")) most = Math.max(most, scene.palette.length);
      continue;
    }
    const kind = kindById(layer.kind);
    if (!kind) continue;
    most = Math.max(most, kind.colors === "all" ? scene.palette.length : kind.colors);
  }
  return Math.min(most, scene.palette.length);
}

export interface ShaderSetting {
  layerId: string;
  spec: ParamSpec;
  /** The words next to the control: the setting's label as the code gives it. */
  label: string;
  value: number | boolean | string;
}

/** The settings (`// @param`) of the layers with your own code, as they stand now: colours, sliders and switches. */
export function shaderSettings(scene: ShaderScene): ShaderSetting[] {
  const out: ShaderSetting[] = [];
  for (const layer of scene.layers) {
    if (!layer.enabled || layer.kind !== "custom" || !layer.code) continue;
    const specs = parsePragmas(layer.code).params.map((p) => p.spec);
    const values = customValues(specs, layer.params);
    for (const spec of specs) {
      const value = values[spec.id];
      if (value === undefined || spec.type === "enum" || spec.type === "stops") continue;
      out.push({ layerId: layer.id, spec, label: spec.label, value });
    }
  }
  return out.slice(0, 12);
}

/** The speed shown as 1×: a loop of this many seconds. Every other speed is this over the loop length. */
export const REFERENCE_LOOP = 20;

/** How fast a loop runs, as a number to show: 1× is a loop of 20 seconds, 2× half of that. */
export const speedFactor = (loop: number): number => REFERENCE_LOOP / Math.max(1, loop);

/** `0.5×`, `1×`, `2.5×`. */
export function speedLabel(loop: number): string {
  const f = speedFactor(loop);
  const text = f < 1 ? f.toFixed(2) : f.toFixed(1);
  return `${text.replace(/\.?0+$/, "")}×`;
}

/** The loop lengths the speed slider spans: a long loop is slow, a short one is lively. */
export const SLOWEST_LOOP = 60;
export const FASTEST_LOOP = 6;

/** 0 (slowest) to 1 (fastest): where a loop length sits on the slider, evenly by ratio. */
export function speedPosition(loop: number): number {
  const clamped = Math.min(SLOWEST_LOOP, Math.max(FASTEST_LOOP, loop));
  return Math.log(SLOWEST_LOOP / clamped) / Math.log(SLOWEST_LOOP / FASTEST_LOOP);
}

/** The loop length (to a tenth of a second) for a slider position. */
export function loopAt(position: number): number {
  const p = Math.min(1, Math.max(0, position));
  const loop = SLOWEST_LOOP * Math.pow(FASTEST_LOOP / SLOWEST_LOOP, p);
  return Math.round(loop * 10) / 10;
}

/**
 * A scene that runs at another speed: the loop gets longer or shorter and the still frame stays on the
 * same picture (it moves with the loop). Every layer keeps its whole number of cycles, so the loop still closes.
 */
export function withLoop(scene: ShaderScene, loop: number): ShaderScene {
  const next = Math.min(SLOWEST_LOOP, Math.max(1, Math.round(loop * 10) / 10));
  const poster = Math.round(((scene.poster * next) / Math.max(1, scene.loop)) * 10) / 10;
  return { ...scene, loop: next, poster: Math.min(poster, Math.max(0, next - 0.1)) };
}
