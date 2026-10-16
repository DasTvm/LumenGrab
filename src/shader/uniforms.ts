import { BLEND_INDEX } from "./glsl";
import { customValues, parsePragmas } from "./custom";
import { kindById, uniformsOf, type KindDef } from "./kinds";
import { normalizeStops, resolveParams } from "./params";
import { layerColors, layerSeed, layerTime, paddedPalette, rgb01 } from "./scene";
import type { ShaderLayer, ShaderScene } from "./types";

/**
 * The numbers each pass of the renderer hands to its shader (docs/FORMAT.md section 4c). Plain data,
 * so it is tested in Node; the renderer only copies it into uniforms by the type the compiled shader reports.
 */
export type UniformValue = number | number[];
export type UniformValues = Record<string, UniformValue>;

const flat3 = (colors: readonly string[], count: number): number[] => {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1)
    out.push(...rgb01(colors[i % Math.max(1, colors.length)] ?? "#000000"));
  return out;
};

/** The reference pixel: the canvas is 1280 pixels wide in the units of every `px` setting. */
export const unitOf = (width: number): number => width / 1280;

/** Values every shader may read, built-in or custom. */
export function commonValues(
  scene: ShaderScene,
  layer: ShaderLayer,
  phase: number,
  width: number,
  height: number,
): UniformValues {
  return {
    u_resolution: [width, height],
    u_phase: phase,
    u_seed: layerSeed(scene, layer),
    u_palette: flat3(paddedPalette(scene), 8),
  };
}

/** The values of a built-in layer. */
export function builtinValues(
  scene: ShaderScene,
  layer: ShaderLayer,
  kind: KindDef,
  phase: number,
  width: number,
  height: number,
): UniformValues {
  const time = layerTime(layer, phase);
  const colors = layerColors(scene, layer, kind);
  const values: UniformValues = {
    ...commonValues(scene, layer, phase, width, height),
    u_a: time.a,
    u_ph: time.ph,
    u_unit: unitOf(width),
    u_lp: flat3(colors, 8),
    u_lpn: Math.max(1, colors.length),
  };
  const resolved = resolveParams(kind.specs, layer.params);
  for (const { name, spec } of uniformsOf(kind)) {
    const v = resolved[spec.id];
    if (spec.type === "enum")
      values[name] = Math.max(
        0,
        spec.options.findIndex((o) => o.id === v),
      );
    else if (spec.type === "bool") values[name] = v === true ? 1 : 0;
    else if (spec.type === "color") values[name] = rgb01(typeof v === "string" ? v : "#000000");
    else if (typeof v === "number") values[name] = v;
  }
  for (const spec of kind.specs) {
    if (spec.type !== "stops") continue;
    const stops = normalizeStops(resolved[spec.id], spec.default);
    values.u_stopN = stops.length;
    const offsets: number[] = [];
    const cols: number[] = [];
    for (let i = 0; i < 8; i += 1) {
      const s = stops[Math.min(i, stops.length - 1)];
      offsets.push(s?.offset ?? 1);
      const [r, g, b] = rgb01(s?.color ?? "#000000");
      const alpha = s ? parseInt(s.color.slice(7, 9) || "ff", 16) / 255 : 1;
      cols.push(r, g, b, alpha);
    }
    values.u_stopOff = offsets;
    values.u_stopCol = cols;
  }
  return values;
}

/** The values of a layer with code: the common ones and its own settings by name. */
export function customLayerValues(
  scene: ShaderScene,
  layer: ShaderLayer,
  phase: number,
  width: number,
  height: number,
): UniformValues {
  const values = commonValues(scene, layer, phase, width, height);
  const specs = parsePragmas(layer.code ?? "").params.map((p) => p.spec);
  const own = customValues(specs, layer.params);
  for (const [name, value] of Object.entries(own)) {
    values[name] =
      typeof value === "boolean"
        ? value
          ? 1
          : 0
        : typeof value === "string"
          ? rgb01(value)
          : value;
  }
  return values;
}

/** The values of the pass that lays a layer's result over the picture below. */
export function compositeValues(
  layer: ShaderLayer,
  effect: boolean,
  width: number,
  height: number,
): UniformValues {
  return {
    u_resolution: [width, height],
    u_opacity: layer.opacity,
    u_mode: BLEND_INDEX[layer.blend],
    u_opaque: effect ? 1 : 0,
  };
}

/** The layers the renderer draws, bottom first: enabled, of a kind this version knows. */
export function drawableLayers(
  scene: ShaderScene,
  canRun: (layer: ShaderLayer) => boolean = () => true,
): ShaderLayer[] {
  return scene.layers.filter((layer) => {
    if (!layer.enabled) return false;
    if (layer.kind === "custom") return (layer.code ?? "").length > 0 && canRun(layer);
    return kindById(layer.kind) !== undefined;
  });
}
