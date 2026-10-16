import { SHADER_LIMITS } from "@/document/limits";
import { parseHex } from "@/presentation/color";
import { kindById, kindDefaults, type KindDef } from "./kinds";
import { ENGINE_VERSION, type LayerRole, type ShaderLayer, type ShaderScene } from "./types";

/** The scene model: defaults, time, colours. Pure, tested in Node (docs/FORMAT.md section 4c). */

export const DEFAULT_PALETTE = ["#2DD4BF", "#0EA5E9", "#84CC16", "#C8FF2E", "#0B3A5C", "#070B14"];
export const DEFAULT_FALLBACK = "#0F172A";

const makeId = () => crypto.randomUUID().slice(0, 12);

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export function newScene(overrides: Partial<ShaderScene> = {}): ShaderScene {
  const loop = overrides.loop ?? 8;
  return {
    type: "shader",
    engine: ENGINE_VERSION,
    loop,
    poster: overrides.poster ?? Math.round(loop * 0.3 * 10) / 10,
    seed: 48213,
    palette: [...DEFAULT_PALETTE],
    fallback: DEFAULT_FALLBACK,
    layers: [],
    ...overrides,
  };
}

/** A new layer of a built-in kind with its defaults. */
export function newLayer(kind: KindDef, id: string = makeId(), seed?: number): ShaderLayer {
  const layer: ShaderLayer = {
    id,
    kind: kind.id,
    enabled: true,
    opacity: 1,
    blend: "normal",
    speed: kind.speed,
    params: kindDefaults(kind),
  };
  if (seed !== undefined) layer.seed = seed;
  return layer;
}

/** A new layer with your own code. `values` are the defaults of its settings. */
export function newCustomLayer(
  role: LayerRole,
  title: string,
  code: string,
  values: ShaderLayer["params"] = {},
  id: string = makeId(),
): ShaderLayer {
  return {
    id,
    kind: "custom",
    name: title,
    role,
    code,
    enabled: true,
    opacity: 1,
    blend: "normal",
    speed: 0,
    params: values,
  };
}

export const customRole = (layer: ShaderLayer): LayerRole => layer.role ?? "generator";

/** What a layer is: a built-in kind, a layer with code, or something this version does not know (it is kept and not drawn). */
export function layerRole(layer: ShaderLayer): LayerRole | null {
  if (layer.kind === "custom") return customRole(layer);
  return kindById(layer.kind)?.role ?? null;
}

export const hasCustomCode = (scene: ShaderScene): boolean =>
  scene.layers.some((l) => l.kind === "custom" && (l.code ?? "").length > 0);

/** Where in the loop a moment is: 0 up to (not including) 1. */
export function phaseAt(scene: ShaderScene, seconds: number): number {
  const loop = Math.max(1, scene.loop);
  const p = (seconds / loop) % 1;
  return p < 0 ? p + 1 : p;
}

/** The moment every still picture shows, kept inside the loop. */
export function posterSeconds(scene: ShaderScene): number {
  return clamp(scene.poster, 0, Math.max(0, scene.loop - 1e-6));
}

/**
 * The two time values a layer's shader gets: `a`, the angle in radians (whole turns per loop) and `ph`,
 * the position inside the current step (0 up to 1, repeating `speed` times per loop). Both are the
 * same at the start and the end of a loop, whatever the speed, because the speed is a whole number.
 */
export function layerTime(layer: ShaderLayer, phase: number): { a: number; ph: number } {
  const sign = layer.direction === "left" || layer.direction === "down" ? -1 : 1;
  const turns = sign * Math.round(layer.speed) * phase;
  return { a: 2 * Math.PI * turns, ph: turns - Math.floor(turns) };
}

/** `up` and `down` swap the axes of the layer, so what travelled sideways now travels vertically. */
export const swapsAxes = (layer: ShaderLayer): boolean =>
  layer.direction === "up" || layer.direction === "down";

/** The seed a layer's shader reads: small enough to be exact as a float. */
export function layerSeed(scene: ShaderScene, layer: ShaderLayer): number {
  return (layer.seed ?? scene.seed) % 1048576;
}

/** The palette as the custom shaders see it: always 8 colours, the palette repeated to fill. */
export function paddedPalette(scene: ShaderScene): string[] {
  const base = scene.palette.length > 0 ? scene.palette : [scene.fallback];
  return Array.from(
    { length: SHADER_LIMITS.maxPalette },
    (_, i) => base[i % base.length] ?? scene.fallback,
  );
}

/** The colours a built-in layer paints with: its share of the palette, the last one swapped for the highlight when the source is custom. */
export function layerColors(scene: ShaderScene, layer: ShaderLayer, kind: KindDef): string[] {
  const palette = scene.palette.length > 0 ? scene.palette : [scene.fallback];
  const count =
    kind.colors === "all" ? palette.length : Math.min(Math.max(kind.colors, 1), palette.length);
  const colors = palette.slice(0, count);
  const highlight = layer.params.highlight;
  if (
    layer.params.source === "custom" &&
    typeof highlight === "string" &&
    /^#[0-9a-fA-F]{6}/.test(highlight)
  ) {
    colors[colors.length - 1] = highlight;
  }
  return colors;
}

/** `#RRGGBB` as three numbers from 0 to 1. */
export function rgb01(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex);
  return [r / 255, g / 255, b / 255];
}

/** True when something in the scene moves: a layer that has speed (and is not a still kind) or code that reads the loop. */
export function sceneMoves(scene: ShaderScene): boolean {
  return scene.layers.some((layer) => {
    if (!layer.enabled) return false;
    if (layer.kind === "custom") return /\bu_phase\b/.test(layer.code ?? "");
    const kind = kindById(layer.kind);
    return kind !== undefined && !kind.still && layer.speed > 0;
  });
}

/** The words under "Colour": which palette colours a layer uses. */
export function paletteUse(kind: KindDef, paletteLength: number): string {
  const n = kind.colors === "all" ? paletteLength : Math.min(kind.colors, paletteLength);
  if (n <= 0) return "";
  if (n === 1) return "Uses palette colour 1";
  return `Uses palette colours 1 to ${String(n)}`;
}

/** A scene with a fresh seed and every layer without its own seed following it. */
export function reseed(scene: ShaderScene, seed: number): ShaderScene {
  return { ...scene, seed: Math.max(0, Math.floor(seed)) % 0x100000000 };
}

/** The layer's name in the Stack. */
export function layerLabel(layer: ShaderLayer): string {
  if (layer.name !== undefined && layer.name !== "") return layer.name;
  if (layer.kind === "custom") return "Shader";
  return kindById(layer.kind)?.label ?? layer.kind;
}
