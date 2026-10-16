import { seededRandom } from "@/document/render/pixels";
import type { Presentation } from "@/document/schema";
import { parseHex, toHex } from "./color";
import { TEMPLATES } from "@/shader/scenes";
import { sortedStops } from "./gradient";

/** Defaults, conversions and generators for the background controls. Pure, tested in Node. */
export type Background = Presentation["background"];
export type BackgroundType = Background["type"];

export const BACKGROUND_TYPES: readonly { id: BackgroundType; label: string }[] = [
  { id: "solid", label: "Solid" },
  { id: "gradient", label: "Gradient" },
  { id: "mesh", label: "Mesh" },
  { id: "image", label: "Image" },
  { id: "source-blur", label: "Blur" },
  { id: "shader", label: "Animated" },
];

export const SOLID_SWATCHES = [
  "#FFFFFF",
  "#F4F4F5",
  "#18181B",
  "#C8FF2E",
  "#2563EB",
  "#16A34A",
  "#F97316",
  "#DB2777",
];

export const DEFAULT_SOURCE_BLUR: Extract<Background, { type: "source-blur" }> = {
  type: "source-blur",
  blur: 40,
  zoom: 1.3,
  dim: 0.1,
  saturation: 1.1,
};

/** The colours of a background on average (for the shadow tint and for a new type that starts from it). */
export function backgroundColors(bg: Background): string[] {
  switch (bg.type) {
    case "solid":
      return [bg.color];
    case "gradient":
      return sortedStops(bg.stops).map((s) => s.color);
    case "mesh":
      return bg.colors;
    case "shader":
      return bg.palette;
    default:
      return [];
  }
}

export function averageColor(colors: readonly string[]): string {
  if (colors.length === 0) return "#808080";
  const sum = [0, 0, 0];
  for (const c of colors) {
    const [r, g, b] = parseHex(c);
    sum[0] = (sum[0] ?? 0) + r;
    sum[1] = (sum[1] ?? 0) + g;
    sum[2] = (sum[2] ?? 0) + b;
  }
  return toHex([
    (sum[0] ?? 0) / colors.length,
    (sum[1] ?? 0) / colors.length,
    (sum[2] ?? 0) / colors.length,
  ]);
}

/** A shadow colour that belongs to the background: its average, darkened. `alpha` is 0..1. */
export function shadowTint(bg: Background, alpha: number): string {
  const [r, g, b] = parseHex(averageColor(backgroundColors(bg)));
  const dark = (v: number) => v * 0.35;
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();
  return `${toHex([dark(r), dark(g), dark(b)])}${a}`;
}

/** The first colour of whatever the background is now: what a switch to `solid` keeps. */
export function firstColor(bg: Background, fallback = "#F4F4F5"): string {
  return backgroundColors(bg)[0] ?? fallback;
}

/** A pleasant palette for shuffles (hand picked, no purple default): each entry is a set of related colours. */
const PALETTES: readonly (readonly string[])[] = [
  ["#C8FF2E", "#84CC16", "#16A34A"],
  ["#FDBA74", "#FB7185", "#C026D3"],
  ["#67E8F9", "#2563EB", "#1E1B4B"],
  ["#FDE68A", "#F97316", "#BE123C"],
  ["#A7F3D0", "#0EA5E9", "#312E81"],
  ["#FECACA", "#F472B6", "#7C3AED"],
  ["#0F172A", "#1E293B", "#334155"],
  ["#F4F4F5", "#E4E4E7", "#D4D4D8"],
  ["#FEF08A", "#FB923C", "#E11D48"],
  ["#99F6E4", "#22D3EE", "#6366F1"],
];

export function randomPalette(seed: number): string[] {
  const random = seededRandom(seed);
  return [...(PALETTES[Math.floor(random() * PALETTES.length)] ?? PALETTES[0] ?? [])];
}

/** The background of another type, starting from what is there. */
export function convertBackground(
  from: Background,
  type: BackgroundType,
  seed: number,
  imageAsset: string | null = null,
): Background {
  if (from.type === type) return from;
  const colors = backgroundColors(from);
  switch (type) {
    case "solid":
      return { type: "solid", color: firstColor(from) };
    case "gradient": {
      const palette = colors.length >= 2 ? colors : randomPalette(seed);
      const stops = (colors.length >= 2 ? palette.slice(0, 6) : palette).map((color, i, all) => ({
        offset: all.length === 1 ? 0 : i / (all.length - 1),
        color,
      }));
      return { type: "gradient", angle: 150, stops };
    }
    case "mesh": {
      const base = colors.length >= 2 ? colors : randomPalette(seed);
      const out: string[] = [];
      for (let i = 0; i < 9; i += 1) out.push(base[i % base.length] ?? "#808080");
      return { type: "mesh", seed, colors: out };
    }
    case "image":
      return { type: "image", asset: imageAsset ?? "", fit: "cover" };
    case "source-blur":
      return { ...DEFAULT_SOURCE_BLUR };
    case "shader": {
      const scene = (TEMPLATES[0] ?? TEMPLATES[TEMPLATES.length - 1])?.make();
      return scene ?? { type: "transparent" };
    }
    case "transparent":
      return { type: "transparent" };
  }
}

type Mesh = Extract<Background, { type: "mesh" }>;

/** The mesh without explicit point positions (so the default layout of its seed is used). */
function withoutPoints(bg: Mesh): Mesh {
  const copy = { ...bg };
  delete copy.points;
  return copy;
}

/** A fresh mesh: new seed and the colours shuffled. */
export function shuffleMesh(bg: Extract<Background, { type: "mesh" }>, seed: number) {
  const random = seededRandom(seed);
  const colors = [...bg.colors];
  for (let i = colors.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [colors[i], colors[j]] = [colors[j] ?? "#808080", colors[i] ?? "#808080"];
  }
  const rest = withoutPoints(bg);
  return { ...rest, seed, colors };
}

/** A mesh with `side x side` colours (3 or 4), keeping the colours it has and filling up from them. */
export function resizeMesh(bg: Extract<Background, { type: "mesh" }>, side: 3 | 4) {
  const count = side * side;
  const colors = Array.from(
    { length: count },
    (_, i) => bg.colors[i % bg.colors.length] ?? "#808080",
  );
  const rest = withoutPoints(bg);
  return { ...rest, colors };
}

/** A new random gradient from the palettes. */
export function shuffleGradient(
  bg: Extract<Background, { type: "gradient" }>,
  seed: number,
): Extract<Background, { type: "gradient" }> {
  const random = seededRandom(seed);
  const palette = randomPalette(seed);
  return {
    ...bg,
    angle: Math.round(random() * 360),
    stops: palette.map((color, i) => ({ offset: i / (palette.length - 1), color })),
  };
}

export function reverseStops(
  bg: Extract<Background, { type: "gradient" }>,
): Extract<Background, { type: "gradient" }> {
  return {
    ...bg,
    stops: sortedStops(bg.stops)
      .map((s) => ({ ...s, offset: Math.round((1 - s.offset) * 1000) / 1000 }))
      .reverse(),
  };
}

/** Adds a stop halfway between stop `index` and the next one (or the previous, at the end). Returns the new list and the new index. */
export function addStop(stops: Extract<Background, { type: "gradient" }>["stops"], index: number) {
  const sorted = sortedStops(stops);
  const at = Math.min(Math.max(0, index), sorted.length - 1);
  const a = sorted[at];
  const b = sorted[at + 1] ?? sorted[at - 1];
  if (!a || !b) return { stops: sorted, index: at };
  const offset = Math.round(((a.offset + b.offset) / 2) * 100) / 100;
  const color = averageColor([a.color, b.color]);
  const next = [...sorted, { offset, color }];
  const ordered = sortedStops(next);
  return {
    stops: ordered,
    index: ordered.findIndex((s) => s.offset === offset && s.color === color),
  };
}

/** The colour of a gradient at `offset` (0..1), mixed between its neighbouring stops. */
export function colorAtOffset(
  stops: Extract<Background, { type: "gradient" }>["stops"],
  offset: number,
): string {
  const sorted = sortedStops(stops);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return "#808080";
  if (offset <= first.offset) return first.color.slice(0, 7);
  if (offset >= last.offset) return last.color.slice(0, 7);
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (!a || !b || offset > b.offset) continue;
    const t = b.offset === a.offset ? 0 : (offset - a.offset) / (b.offset - a.offset);
    const [r1, g1, b1] = parseHex(a.color);
    const [r2, g2, b2] = parseHex(b.color);
    return toHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
  }
  return last.color.slice(0, 7);
}
