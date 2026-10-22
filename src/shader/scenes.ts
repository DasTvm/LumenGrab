import { kindById } from "./kinds";
import { SHADER_LIMITS } from "@/document/limits";
import { newCustomLayer, newLayer, newScene } from "./scene";
import type { BlendMode, LayerRole, ShaderLayer, ShaderParamValue, ShaderScene } from "./types";

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

/** The twelve animated looks of the Presentation panel: big soft shapes, calm colours. Each loop is as long as its motion needs to feel alive but calm (measured: about the same change per second for all). */

/** Fine texture that does not move: moving grain reads as flicker. */
const GRAIN = (amount: number): Spec => [
  "grain",
  { params: { amount, size: 1.4, animate: false } },
];

export const ANIMATED_LOOKS: readonly AnimatedLook[] = [
  {
    id: "animated-aurora",
    name: "Aurora",
    make: () =>
      scene(
        ["#3DDBB5", "#3B82F6", "#8B5CF6", "#0B2A4A"],
        "#050A16",
        [
          [
            "aurora",
            {
              blend: "screen",
              opacity: 0.8,
              speed: 1,
              direction: "left",
              params: { scale: 1.05, rotation: 24 },
            },
          ],
          ["orbs", { opacity: 0.4, params: { count: 3, size: 1, softness: 1, spread: 0.4 } }],
          ["vignette", { params: { amount: 0.35, softness: 0.8 } }],
          GRAIN(0.1),
        ],
        { loop: 48 },
      ),
  },
  {
    id: "animated-nebula",
    name: "Nebula",
    make: () =>
      scene(
        ["#6366F1", "#A855F7", "#EC4899", "#3B82F6", "#111A3D"],
        "#0B1030",
        [
          ["orbs", { params: { count: 5, size: 0.8, softness: 0.95, spread: 0.45 } }],
          ["vignette", { params: { amount: 0.4, softness: 0.9 } }],
          GRAIN(0.1),
        ],
        { loop: 21 },
      ),
  },
  {
    id: "animated-silk",
    name: "Silk",
    make: () =>
      scene(
        ["#F8EBDD", "#EFC1B0", "#B58AB8", "#5B4B8A"],
        "#5B4B8A",
        [["liquid", { params: { scale: 0.7, warp: 0.55, detail: 2 } }], GRAIN(0.08)],
        { loop: 28 },
      ),
  },
  {
    id: "animated-ink",
    name: "Ink",
    make: () =>
      scene(
        ["#D9DEE7", "#8D97A8", "#3A4254", "#0D111A"],
        "#0D111A",
        [
          ["liquid", { params: { scale: 0.75, warp: 0.6, detail: 2 } }],
          ["vignette", { params: { amount: 0.3, softness: 0.9 } }],
          GRAIN(0.1),
        ],
        { loop: 36 },
      ),
  },
  {
    id: "animated-dusk",
    name: "Dusk",
    make: () =>
      scene(
        ["#FB923C", "#F43F5E", "#A855F7", "#4338CA"],
        "#1E1B4B",
        [
          ["orbs", { params: { count: 4, size: 1.1, softness: 1, spread: 0.35 } }],
          ["glow", { params: { threshold: 0.55, intensity: 0.35, radius: 0.1 } }],
          GRAIN(0.1),
        ],
        { loop: 21 },
      ),
  },
  {
    id: "animated-haze",
    name: "Haze",
    make: () =>
      scene(
        ["#FFC9B8", "#F9B3C8", "#F9D9B0", "#FFF3E8"],
        "#FFEFE3",
        [["orbs", { params: { count: 5, size: 1, softness: 1, spread: 0.4 } }], GRAIN(0.06)],
        { loop: 12 },
      ),
  },
  {
    id: "animated-mist",
    name: "Mist",
    make: () =>
      scene(
        ["#AFC6FF", "#D2BEFF", "#A6E3F2", "#F4F7FF"],
        "#EAF0FF",
        [["orbs", { params: { count: 5, size: 1, softness: 1, spread: 0.4 } }], GRAIN(0.06)],
        { loop: 12 },
      ),
  },
  {
    id: "animated-tide",
    name: "Tide",
    make: () =>
      scene(
        ["#7CD0E8", "#3D9BCB", "#1F6FA8", "#10407A"],
        "#0B2A55",
        [
          ["waves", { params: { count: 4, amplitude: 0.45, frequency: 1.1, softness: 0.85 } }],
          ["vignette", { params: { amount: 0.25, softness: 0.9 } }],
          GRAIN(0.08),
        ],
        { loop: 22 },
      ),
  },
  {
    id: "animated-ember",
    name: "Ember",
    make: () =>
      scene(
        ["#F59E0B", "#DC4C1F", "#8E1B2E", "#2B0A14"],
        "#1A0509",
        [
          ["liquid", { params: { scale: 0.8, warp: 0.7, detail: 3 } }],
          ["vignette", { params: { amount: 0.35, softness: 0.9 } }],
          GRAIN(0.1),
        ],
        { loop: 44 },
      ),
  },
  {
    id: "animated-midnight",
    name: "Midnight",
    make: () =>
      scene(
        ["#F1F5FF", "#A5B4FC", "#312E81", "#0B1030"],
        "#070A1E",
        [
          ["orbs", { opacity: 0.55, params: { count: 3, size: 1.1, softness: 1, spread: 0.3 } }],
          [
            "stars",
            {
              blend: "screen",
              opacity: 0.8,
              params: { density: 0.3, size: 0.7, twinkle: 0.45, drift: 0.2 },
            },
          ],
          ["vignette", { params: { amount: 0.4, softness: 0.9 } }],
        ],
        { loop: 12 },
      ),
  },
  {
    id: "animated-spotlight",
    name: "Spotlight",
    make: () =>
      scene(
        ["#BFD4FF", "#E8EEFF", "#101A3A", "#070B1A"],
        "#080D1F",
        [
          [
            "rays",
            {
              blend: "screen",
              opacity: 0.75,
              params: { count: 6, spread: 0.5, softness: 1, falloff: 0.4, originY: 1.3 },
            },
          ],
          ["orbs", { opacity: 0.3, params: { count: 2, size: 1.2, softness: 1, spread: 0.3 } }],
          ["vignette", { params: { amount: 0.35, softness: 0.9 } }],
          GRAIN(0.08),
        ],
        { loop: 12 },
      ),
  },
  {
    id: "animated-mint",
    name: "Mint",
    make: () =>
      scene(
        ["#9EE8CB", "#6FCFC0", "#BFE0FF", "#F2FFFB"],
        "#E8FBF3",
        [["liquid", { params: { scale: 0.7, warp: 0.5, detail: 2 } }], GRAIN(0.06)],
        { loop: 17 },
      ),
  },
];

/** What a shader of yours is, as far as a scene is concerned. */
export interface ShaderSource {
  name: string;
  role: LayerRole;
  code: string;
  values: ShaderLayer["params"];
}

/** The layer of a scene that runs this shader (same name and same code), if any. */
export const findShaderLayer = (
  scene: ShaderScene,
  shader: ShaderSource,
): ShaderLayer | undefined =>
  scene.layers.find(
    (l) => l.kind === "custom" && l.code === shader.code && (l.name ?? "") === shader.name,
  );

/**
 * A scene for a shader of yours: a generator is the whole background; an effect goes on top of the background
 * you have (or on the first look when that is not an animated one), because it has nothing to change on its own.
 */
export function sceneWithShader(
  shader: ShaderSource,
  current: ShaderScene | null,
): { scene: ShaderScene; layerId: string } {
  const layer = newCustomLayer(shader.role, shader.name, shader.code, { ...shader.values });
  if (shader.role === "effect") {
    const base = current ?? ANIMATED_LOOKS[0]?.make() ?? newScene();
    const kept = base.layers.slice(-(SHADER_LIMITS.maxLayers - 1));
    return { scene: { ...base, layers: [...kept, layer] }, layerId: layer.id };
  }
  const blank = TEMPLATES.find((t) => t.id === "blank")?.make() ?? newScene();
  return { scene: { ...blank, loop: 20, poster: 6, layers: [layer] }, layerId: layer.id };
}
