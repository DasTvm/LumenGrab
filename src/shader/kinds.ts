import { builtinFragment, KIND_SHADERS } from "./glsl";
import { defaultParams, type NumberSpec, type ParamSpec } from "./params";
import type { LayerRole } from "./types";

/**
 * Every kind of layer and effect the Studio ships (docs/FORMAT.md section 4c), described once: its
 * settings (the Inspector and the renderer are both made from them) and its shader.
 */
export interface KindDef {
  id: string;
  label: string;
  role: LayerRole;
  /** Cycles per loop of a new layer. */
  speed: number;
  /** A kind without motion has no Speed and Direction. */
  still?: boolean;
  /** How many palette colours the layer uses (`all` = the whole palette); 0 = it has its own colour setting or none. */
  colors: number | "all";
  specs: ParamSpec[];
}

const num = (
  id: string,
  label: string,
  group: string,
  min: number,
  max: number,
  def: number,
  extra: Partial<NumberSpec> = {},
): NumberSpec => ({
  id,
  label,
  group,
  type: "number",
  min,
  max,
  step: (max - min) / 200,
  default: def,
  ...extra,
});
const int = (
  id: string,
  label: string,
  group: string,
  min: number,
  max: number,
  def: number,
  extra: Partial<NumberSpec> = {},
): NumberSpec => ({ ...num(id, label, group, min, max, def, extra), type: "int", step: 1 });
const bool = (id: string, label: string, group: string, def: boolean): ParamSpec => ({
  id,
  label,
  group,
  type: "bool",
  default: def,
});
const percent = (
  id: string,
  label: string,
  group: string,
  def: number,
  extra: Partial<NumberSpec> = {},
) => num(id, label, group, 0, 1, def, { unit: "%", step: 0.01, ...extra });
const turn = (def: number) =>
  num("rotation", "Rotation", "Shape", -180, 180, def, { unit: "°", step: 1, decimals: 0 });

/** The Colour section of a kind that paints with palette colours. */
const COLOUR: ParamSpec[] = [
  {
    id: "source",
    label: "Source",
    group: "Colour",
    type: "enum",
    options: [
      { id: "palette", label: "Palette" },
      { id: "custom", label: "Custom" },
    ],
    default: "palette",
  },
  {
    id: "highlight",
    label: "Highlight",
    group: "Colour",
    type: "color",
    default: "#C8FF2E",
    when: { id: "source", equals: "custom" },
  },
];

export const KINDS: readonly KindDef[] = [
  {
    id: "gradient",
    label: "Gradient",
    role: "generator",
    speed: 1,
    colors: 0,
    specs: [
      {
        id: "type",
        label: "Type",
        group: "Gradient",
        type: "enum",
        options: [
          { id: "linear", label: "Linear" },
          { id: "radial", label: "Radial" },
          { id: "conic", label: "Conic" },
          { id: "diamond", label: "Diamond" },
        ],
        default: "linear",
      },
      {
        id: "stops",
        label: "Colours",
        group: "Gradient",
        type: "stops",
        default: [
          { offset: 0, color: "#0F172A" },
          { offset: 1, color: "#84CC16" },
        ],
      },
      num("angle", "Angle", "Gradient", 0, 360, 150, { unit: "°", step: 1, decimals: 0 }),
    ],
  },
  {
    id: "orbs",
    label: "Orbs",
    role: "generator",
    speed: 1,
    colors: "all",
    specs: [
      int("count", "Count", "Shape", 2, 12, 5),
      num("size", "Size", "Shape", 0.2, 1.2, 0.5, { step: 0.01 }),
      percent("softness", "Softness", "Shape", 0.6),
      percent("spread", "Roaming", "Shape", 0.5),
      ...COLOUR,
    ],
  },
  {
    id: "aurora",
    label: "Aurora",
    role: "generator",
    speed: 2,
    colors: 3,
    specs: [
      num("scale", "Scale", "Shape", 0.3, 4, 1.2, { unit: "×", step: 0.05, decimals: 1 }),
      turn(35),
      num("offsetX", "X", "Shape", -1, 1, 0.1, { step: 0.01, decimals: 2 }),
      num("offsetY", "Y", "Shape", -1, 1, -0.05, { step: 0.01, decimals: 2 }),
      ...COLOUR,
    ],
  },
  {
    id: "waves",
    label: "Waves",
    role: "generator",
    speed: 1,
    colors: "all",
    specs: [
      int("count", "Count", "Shape", 2, 12, 5),
      percent("amplitude", "Height", "Shape", 0.6),
      num("frequency", "Frequency", "Shape", 0.5, 8, 2, { unit: "×", step: 0.1, decimals: 1 }),
      turn(0),
      percent("softness", "Softness", "Shape", 0.15),
      ...COLOUR,
    ],
  },
  {
    id: "liquid",
    label: "Liquid",
    role: "generator",
    speed: 1,
    colors: 4,
    specs: [
      num("scale", "Scale", "Shape", 0.3, 6, 1.6, { unit: "×", step: 0.05, decimals: 1 }),
      num("warp", "Warp", "Shape", 0, 2, 1, { step: 0.05, decimals: 2 }),
      int("detail", "Detail", "Shape", 1, 5, 3),
      turn(0),
      ...COLOUR,
    ],
  },
  {
    id: "cells",
    label: "Cells",
    role: "generator",
    speed: 1,
    colors: 3,
    specs: [
      num("scale", "Scale", "Shape", 2, 40, 8, { unit: "×", step: 0.5, decimals: 1 }),
      percent("softness", "Softness", "Shape", 0.5),
      percent("jitter", "Irregularity", "Shape", 1),
      bool("edges", "Edges only", "Shape", false),
      ...COLOUR,
    ],
  },
  {
    id: "ripples",
    label: "Ripples",
    role: "generator",
    speed: 1,
    colors: 2,
    specs: [
      percent("centerX", "Centre X", "Shape", 0.5),
      percent("centerY", "Centre Y", "Shape", 0.5),
      num("spacing", "Spacing", "Shape", 0.03, 0.5, 0.12, { step: 0.005, decimals: 3 }),
      percent("thickness", "Thickness", "Shape", 0.4),
      percent("fade", "Fade", "Shape", 0.5),
      ...COLOUR,
    ],
  },
  {
    id: "pattern",
    label: "Pattern",
    role: "generator",
    speed: 1,
    colors: 1,
    specs: [
      {
        id: "shape",
        label: "Shape",
        group: "Shape",
        type: "enum",
        options: [
          { id: "stripes", label: "Stripes" },
          { id: "grid", label: "Grid" },
          { id: "dots", label: "Dots" },
        ],
        default: "stripes",
      },
      num("scale", "Scale", "Shape", 2, 60, 14, { unit: "×", step: 0.5, decimals: 1 }),
      num("angle", "Angle", "Shape", -90, 90, 30, { unit: "°", step: 1, decimals: 0 }),
      percent("thickness", "Thickness", "Shape", 0.35),
      percent("softness", "Softness", "Shape", 0.1),
      ...COLOUR,
    ],
  },
  {
    id: "rays",
    label: "Light rays",
    role: "generator",
    speed: 1,
    colors: 2,
    specs: [
      int("count", "Rays", "Shape", 3, 40, 12),
      num("originX", "Origin X", "Shape", -0.5, 1.5, 0.5, { step: 0.01, decimals: 2 }),
      num("originY", "Origin Y", "Shape", -0.5, 1.5, 1.1, { step: 0.01, decimals: 2 }),
      percent("spread", "Width", "Shape", 0.6),
      percent("softness", "Softness", "Shape", 0.6),
      percent("falloff", "Falloff", "Shape", 0.5),
      ...COLOUR,
    ],
  },
  {
    id: "stars",
    label: "Stars",
    role: "generator",
    speed: 1,
    colors: 2,
    specs: [
      percent("density", "Amount", "Shape", 0.5),
      num("size", "Size", "Shape", 0.3, 3, 1, { unit: "×", step: 0.05, decimals: 1 }),
      percent("twinkle", "Twinkle", "Shape", 0.6),
      percent("drift", "Drift", "Shape", 0.3),
      ...COLOUR,
    ],
  },
  {
    id: "solid",
    label: "Solid",
    role: "generator",
    speed: 0,
    still: true,
    colors: 0,
    specs: [{ id: "color", label: "Colour", group: "Colour", type: "color", default: "#0F172A" }],
  },
  {
    id: "warp",
    label: "Warp",
    role: "effect",
    speed: 1,
    colors: 0,
    specs: [
      percent("amount", "Amount", "Effect", 0.4),
      num("scale", "Scale", "Effect", 0.3, 6, 2, { unit: "×", step: 0.05, decimals: 1 }),
    ],
  },
  {
    id: "swirl",
    label: "Swirl",
    role: "effect",
    speed: 0,
    colors: 0,
    specs: [
      num("amount", "Twist", "Effect", -2, 2, 0.6, { step: 0.05, decimals: 2 }),
      num("radius", "Radius", "Effect", 0.05, 1.5, 0.6, { step: 0.01, decimals: 2 }),
      percent("centerX", "Centre X", "Effect", 0.5),
      percent("centerY", "Centre Y", "Effect", 0.5),
    ],
  },
  {
    id: "chromatic",
    label: "Chromatic shift",
    role: "effect",
    speed: 0,
    colors: 0,
    specs: [
      num("amount", "Amount", "Effect", 0, 60, 6, { unit: "px", step: 0.5, decimals: 1 }),
      num("angle", "Angle", "Effect", 0, 360, 0, { unit: "°", step: 1, decimals: 0 }),
    ],
  },
  {
    id: "pixelate",
    label: "Pixelate",
    role: "effect",
    speed: 0,
    colors: 0,
    specs: [
      int("size", "Cell size", "Effect", 2, 200, 12, { unit: "px" }),
      bool("square", "Square cells", "Effect", true),
      percent("amount", "Amount", "Effect", 1),
      bool("animate", "Animate cell size", "Motion", false),
    ],
  },
  {
    id: "posterize",
    label: "Posterize",
    role: "effect",
    speed: 0,
    still: true,
    colors: 0,
    specs: [int("levels", "Levels", "Effect", 2, 16, 5), percent("amount", "Amount", "Effect", 1)],
  },
  {
    id: "vignette",
    label: "Vignette",
    role: "effect",
    speed: 0,
    still: true,
    colors: 0,
    specs: [
      percent("amount", "Amount", "Effect", 0.4),
      percent("softness", "Softness", "Effect", 0.5),
      percent("roundness", "Follow the shape", "Effect", 0.5),
    ],
  },
  {
    id: "grain",
    label: "Film grain",
    role: "effect",
    speed: 1,
    colors: 0,
    specs: [
      percent("amount", "Amount", "Effect", 0.3),
      num("size", "Grain size", "Effect", 0.5, 6, 1.2, { unit: "px", step: 0.1, decimals: 1 }),
      bool("animate", "Animate the grain", "Motion", false),
    ],
  },
  {
    id: "glow",
    label: "Glow",
    role: "effect",
    speed: 0,
    still: true,
    colors: 0,
    specs: [
      percent("threshold", "Threshold", "Effect", 0.6),
      num("radius", "Radius", "Effect", 0.005, 0.2, 0.06, { step: 0.005, decimals: 3 }),
      num("intensity", "Intensity", "Effect", 0, 2, 0.8, { step: 0.05, decimals: 2 }),
    ],
  },
  {
    id: "grade",
    label: "Color grade",
    role: "effect",
    speed: 0,
    still: true,
    colors: 0,
    specs: [
      int("brightness", "Brightness", "Grade", -100, 100, 0, { signed: true }),
      int("contrast", "Contrast", "Grade", -100, 100, 0, { signed: true }),
      num("saturation", "Saturation", "Grade", 0, 3, 1, { unit: "%", step: 0.01 }),
      int("hue", "Hue", "Grade", -180, 180, 0, { unit: "°" }),
      { id: "tint", label: "Colour", group: "Tint", type: "color", default: "#0EA5E9" },
      percent("tintAmount", "Amount", "Tint", 0),
    ],
  },
];

const BY_ID = new Map(KINDS.map((k) => [k.id, k]));

export const kindById = (id: string): KindDef | undefined => BY_ID.get(id);

export const GENERATORS = KINDS.filter((k) => k.role === "generator");
export const EFFECTS = KINDS.filter((k) => k.role === "effect");

export const kindDefaults = (kind: KindDef) => defaultParams(kind.specs);

/** Settings that are worked out in TypeScript (the layer's colours) and so are not uniforms. */
const NOT_UNIFORMS = new Set(["source", "highlight", "stops", "type", "shape"]);
/** Enumerated settings the shader reads as a number (the position in the list). */
const ENUM_UNIFORMS = new Set(["type", "shape"]);

export function uniformsOf(
  kind: KindDef,
): { name: string; glsl: "float" | "vec3"; spec: ParamSpec }[] {
  const out: { name: string; glsl: "float" | "vec3"; spec: ParamSpec }[] = [];
  for (const spec of kind.specs) {
    if (spec.type === "stops") continue;
    if (NOT_UNIFORMS.has(spec.id) && !ENUM_UNIFORMS.has(spec.id)) continue;
    out.push({ name: `u_${spec.id}`, glsl: spec.type === "color" ? "vec3" : "float", spec });
  }
  return out;
}

/** The fragment shader source of a built-in kind. */
export function kindFragment(kind: KindDef): string {
  const shader = KIND_SHADERS[kind.id];
  if (!shader) throw new Error(`no shader for ${kind.id}`);
  return builtinFragment(uniformsOf(kind), shader.extra, shader.body);
}
