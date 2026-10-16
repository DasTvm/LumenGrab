import { kindById } from "./kinds";
import { newLayer, newScene } from "./scene";
import type { BlendMode, ShaderLayer, ShaderParamValue, ShaderScene } from "./types";

/**
 * The scenes that ship with the Studio: the "Start from..." templates and the animated looks of the
 * gallery. Made from our own layers, nothing copied. Layer ids are fixed so a scene is the same every time.
 */

interface Patch {
  opacity?: number;
  blend?: BlendMode;
  speed?: number;
  direction?: ShaderLayer["direction"];
  seed?: number;
  params?: Record<string, ShaderParamValue>;
}

function layer(kind: string, patch: Patch, index: number): ShaderLayer {
  const def = kindById(kind);
  if (!def) throw new Error(`unknown kind ${kind}`);
  const made = newLayer(def, `${kind}-${String(index + 1)}`);
  made.params = { ...made.params, ...patch.params };
  if (patch.opacity !== undefined) made.opacity = patch.opacity;
  if (patch.blend) made.blend = patch.blend;
  if (patch.speed !== undefined) made.speed = patch.speed;
  if (patch.direction) made.direction = patch.direction;
  if (patch.seed !== undefined) made.seed = patch.seed;
  return made;
}

type Spec = [string, Patch?];

function scene(
  palette: string[],
  fallback: string,
  layers: Spec[],
  extra: Partial<ShaderScene> = {},
): ShaderScene {
  return newScene({
    palette,
    fallback,
    layers: layers.map(([kind, patch], i) => layer(kind, patch ?? {}, i)),
    ...extra,
  });
}

const stops = (...colors: string[]): ShaderParamValue =>
  colors.map((color, i) => ({
    offset: colors.length === 1 ? 0 : i / (colors.length - 1),
    color,
  }));

const AURORA_NIGHT = () =>
  scene(
    ["#2DD4BF", "#0EA5E9", "#84CC16", "#C8FF2E", "#0B3A5C", "#050A14"],
    "#050A14",
    [
      ["gradient", { params: { type: "linear", angle: 180, stops: stops("#050A14", "#0B2F4A") } }],
      ["orbs", { blend: "screen", opacity: 0.3, params: { count: 4, size: 0.8, softness: 0.9 } }],
      [
        "aurora",
        {
          blend: "screen",
          opacity: 0.55,
          speed: 1,
          direction: "left",
          seed: 777,
          params: { scale: 1.7, rotation: -18, offsetY: 0.22 },
        },
      ],
      ["aurora", { blend: "screen", opacity: 0.95 }],
      ["grain", { blend: "overlay", opacity: 0.25, speed: 1 }],
    ],
    { seed: 48213 },
  );

export interface SceneTemplate {
  id: string;
  name: string;
  make: () => ShaderScene;
}

/** "Start from..." in the Stack. */
export const TEMPLATES: readonly SceneTemplate[] = [
  { id: "aurora-night", name: "Aurora night", make: AURORA_NIGHT },
  {
    id: "soft-orbs",
    name: "Soft orbs",
    make: () =>
      scene(["#2563EB", "#06B6D4", "#F59E0B", "#EC4899", "#A3E635", "#111827"], "#0B1020", [
        ["gradient", { params: { type: "radial", stops: stops("#16203A", "#0B1020") } }],
        ["orbs", { blend: "screen", params: { count: 6, size: 0.6, softness: 0.8 } }],
        ["grain", { blend: "overlay", opacity: 0.25 }],
      ]),
  },
  {
    id: "ocean-waves",
    name: "Ocean waves",
    make: () =>
      scene(["#DFF6FF", "#9ADCF2", "#5CC8E8", "#1E90C8", "#0B5C8A", "#06223A"], "#06223A", [
        [
          "gradient",
          { params: { type: "linear", angle: 180, stops: stops("#BFEFFF", "#1E90C8") } },
        ],
        ["waves", { params: { count: 6, amplitude: 0.7, frequency: 1.6, softness: 0.1 } }],
        ["vignette", { params: { amount: 0.3 } }],
      ]),
  },
  {
    id: "liquid-metal",
    name: "Liquid metal",
    make: () =>
      scene(["#D7DEEA", "#8A97B0", "#3A4256", "#15151F"], "#15151F", [
        ["liquid", { params: { scale: 1.4, warp: 1.2, detail: 4 } }],
        ["grade", { params: { contrast: 18, saturation: 0.7 } }],
        ["grain", { blend: "overlay", opacity: 0.25 }],
      ]),
  },
  {
    id: "neon-rays",
    name: "Neon rays",
    make: () =>
      scene(["#FF2E93", "#2EE6FF", "#1B0B3D", "#070312"], "#070312", [
        [
          "gradient",
          { params: { type: "linear", angle: 180, stops: stops("#070312", "#1B0B3D") } },
        ],
        [
          "rays",
          { blend: "screen", opacity: 0.8, params: { count: 14, spread: 0.45, softness: 0.5 } },
        ],
        ["stars", { blend: "screen", opacity: 0.6, params: { density: 0.35 } }],
        ["glow", { params: { threshold: 0.35, intensity: 0.9 } }],
      ]),
  },
  {
    id: "starfield",
    name: "Starfield",
    make: () =>
      scene(["#FFFFFF", "#BFD4FF", "#0A1230", "#03050C"], "#03050C", [
        ["gradient", { params: { type: "radial", stops: stops("#0A1230", "#03050C") } }],
        ["stars", { blend: "screen", params: { density: 0.7, twinkle: 0.8, drift: 0.2 } }],
        ["glow", { params: { threshold: 0.7, intensity: 0.5 } }],
      ]),
  },
  {
    id: "blank",
    name: "Blank",
    make: () => scene(["#0B1020", "#2563EB", "#06B6D4", "#C8FF2E"], "#0B1020", []),
  },
];

export interface AnimatedLook {
  id: string;
  name: string;
  make: () => ShaderScene;
}

/** The fourteen animated looks of the Presentation panel. */
export const ANIMATED_LOOKS: readonly AnimatedLook[] = [
  { id: "animated-aurora", name: "Aurora", make: AURORA_NIGHT },
  {
    id: "animated-orbs",
    name: "Orbs",
    make: () =>
      scene(["#2563EB", "#06B6D4", "#F59E0B", "#EC4899", "#A3E635", "#111827"], "#0B1020", [
        [
          "gradient",
          { params: { type: "linear", angle: 160, stops: stops("#0B1020", "#16203A") } },
        ],
        ["orbs", { blend: "screen", params: { count: 6, size: 0.6, softness: 0.7 } }],
        ["grain", { blend: "overlay", opacity: 0.2 }],
      ]),
  },
  {
    id: "animated-waves",
    name: "Waves",
    make: () =>
      scene(["#DFF6FF", "#9ADCF2", "#5CC8E8", "#1E90C8", "#0B5C8A", "#06223A"], "#06223A", [
        [
          "gradient",
          { params: { type: "linear", angle: 180, stops: stops("#DFF6FF", "#5CC8E8") } },
        ],
        ["waves", { params: { count: 6, amplitude: 0.7, frequency: 1.6, softness: 0.1 } }],
      ]),
  },
  {
    id: "animated-liquid",
    name: "Liquid",
    make: () =>
      scene(["#E0F2FE", "#38BDF8", "#1D4ED8", "#0F172A"], "#0F172A", [
        ["liquid", { params: { scale: 1.2, warp: 1.3, detail: 4 } }],
        ["grain", { blend: "overlay", opacity: 0.2 }],
      ]),
  },
  {
    id: "animated-cells",
    name: "Cells",
    make: () =>
      scene(["#F6C85F", "#2E86AB", "#1F4E79", "#14213D"], "#14213D", [
        ["cells", { params: { scale: 7, softness: 0.7, jitter: 0.8 } }],
        ["vignette", { params: { amount: 0.35 } }],
      ]),
  },
  {
    id: "animated-ripples",
    name: "Ripples",
    make: () =>
      scene(["#86E3FF", "#1D6FA5", "#071A2B"], "#071A2B", [
        ["gradient", { params: { type: "radial", stops: stops("#0E3A5C", "#071A2B") } }],
        [
          "ripples",
          { blend: "screen", opacity: 0.8, params: { spacing: 0.1, thickness: 0.3, fade: 0.4 } },
        ],
        [
          "ripples",
          { blend: "screen", opacity: 0.5, params: { centerX: 0.15, centerY: 0.8, spacing: 0.14 } },
        ],
      ]),
  },
  {
    id: "animated-rays",
    name: "Rays",
    make: () =>
      scene(["#FFD166", "#FFF4D6", "#274690", "#0A0F1F"], "#0A0F1F", [
        ["gradient", { params: { type: "linear", angle: 0, stops: stops("#274690", "#0A0F1F") } }],
        [
          "rays",
          { blend: "screen", opacity: 0.85, params: { count: 10, spread: 0.4, softness: 0.7 } },
        ],
        ["glow", { params: { threshold: 0.4, intensity: 0.7 } }],
      ]),
  },
  {
    id: "animated-starfield",
    name: "Starfield",
    make: () => TEMPLATES[5]?.make() ?? AURORA_NIGHT(),
  },
  {
    id: "animated-weave",
    name: "Weave",
    make: () =>
      scene(["#C8FF2E", "#1D4ED8", "#101828"], "#101828", [
        ["liquid", { params: { scale: 1, warp: 0.8 } }],
        [
          "pattern",
          {
            blend: "soft-light",
            opacity: 0.6,
            params: { shape: "grid", scale: 18, thickness: 0.2 },
          },
        ],
        ["grain", { blend: "overlay", opacity: 0.2 }],
      ]),
  },
  {
    id: "animated-haze",
    name: "Haze",
    make: () =>
      scene(["#FCD5CE", "#F8AFA6", "#F6C6A0", "#FFF1E6"], "#FCD5CE", [
        ["liquid", { params: { scale: 0.9, warp: 0.7, detail: 3 } }],
        [
          "orbs",
          { blend: "soft-light", opacity: 0.7, params: { count: 4, size: 0.7, softness: 1 } },
        ],
        ["grain", { blend: "overlay", opacity: 0.2 }],
      ]),
  },
  {
    id: "animated-sunrise",
    name: "Sunrise",
    make: () =>
      scene(["#FFE066", "#FF9E00", "#F72585", "#B5179E", "#2B1055"], "#2B1055", [
        [
          "gradient",
          {
            params: {
              type: "linear",
              angle: 0,
              stops: stops("#FFE066", "#FF9E00", "#F72585", "#2B1055"),
            },
          },
        ],
        ["orbs", { blend: "screen", opacity: 0.5, params: { count: 4, size: 0.7, softness: 0.9 } }],
        [
          "rays",
          {
            blend: "screen",
            opacity: 0.35,
            params: { count: 9, spread: 0.35, softness: 0.8, originY: 0.1 },
          },
        ],
      ]),
  },
  {
    id: "animated-lava",
    name: "Lava",
    make: () =>
      scene(["#1A0500", "#7A1200", "#E03A00", "#FF9A1F", "#FFE08A"], "#1A0500", [
        ["liquid", { params: { scale: 1.1, warp: 1.5, detail: 4 } }],
        ["warp", { params: { amount: 0.3 } }],
        ["glow", { params: { threshold: 0.5, intensity: 0.8 } }],
        ["grain", { blend: "overlay", opacity: 0.25 }],
      ]),
  },
  {
    id: "animated-glacier",
    name: "Glacier",
    make: () =>
      scene(["#E8F6FA", "#81C3D7", "#3A7CA5", "#0A1B2E"], "#0A1B2E", [
        ["cells", { params: { scale: 5, softness: 0.9, jitter: 0.7 } }],
        [
          "ripples",
          { blend: "soft-light", opacity: 0.5, params: { spacing: 0.2, thickness: 0.5 } },
        ],
        ["chromatic", { params: { amount: 4 } }],
      ]),
  },
  {
    id: "animated-midnight",
    name: "Midnight",
    make: () =>
      scene(["#F8FAFC", "#94A3B8", "#1E293B", "#0F172A"], "#0F172A", [
        [
          "gradient",
          { params: { type: "linear", angle: 160, stops: stops("#0F172A", "#1E293B") } },
        ],
        ["stars", { blend: "screen", params: { density: 0.45, twinkle: 0.7 } }],
        ["vignette", { params: { amount: 0.35 } }],
      ]),
  },
];
