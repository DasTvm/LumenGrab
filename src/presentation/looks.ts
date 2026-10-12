import type { Presentation } from "@/document/schema";
import { defaultPresentation } from "@/document/write";
import { shadowTint, type Background } from "./backgrounds";

/**
 * A look is a set of presentation settings that can be applied to any picture: the built-in ones and
 * the user's own. It holds only the parts it was made with (a look made from the background alone does
 * not touch the padding). Lengths are stored for a picture 1280 px wide and scaled to the picture a look
 * is applied to, so a look made on a small screenshot looks the same on a Retina one.
 */
export type LookPart = "background" | "padding" | "cornerRadius" | "shadow" | "frame" | "aspect";

export const LOOK_PARTS: readonly { id: LookPart; label: string }[] = [
  { id: "background", label: "Background" },
  { id: "padding", label: "Padding" },
  { id: "cornerRadius", label: "Corner radius" },
  { id: "shadow", label: "Shadow" },
  { id: "frame", label: "Window frame" },
  { id: "aspect", label: "Aspect ratio" },
];

export type LookParts = Partial<Pick<Presentation, LookPart>>;

export interface Look {
  id: string;
  name: string;
  parts: LookParts;
}

export const REFERENCE_WIDTH = 1280;

/** The factor lengths of a look are multiplied with for a picture `width` pixels wide. */
export function lengthScale(width: number): number {
  return Math.min(4, Math.max(0.25, width / REFERENCE_WIDTH));
}

const round = (n: number) => Math.round(n * 10) / 10;

function scaleParts(parts: LookParts, k: number): LookParts {
  const out: LookParts = { ...parts };
  if (parts.padding) {
    const { top, right, bottom, left } = parts.padding;
    out.padding = {
      ...parts.padding,
      top: Math.round(top * k),
      right: Math.round(right * k),
      bottom: Math.round(bottom * k),
      left: Math.round(left * k),
    };
  }
  if (parts.cornerRadius !== undefined) out.cornerRadius = Math.round(parts.cornerRadius * k);
  if (parts.shadow) {
    out.shadow = {
      ...parts.shadow,
      x: round(parts.shadow.x * k),
      y: round(parts.shadow.y * k),
      blur: round(parts.shadow.blur * k),
      spread: round(parts.shadow.spread * k),
    };
  }
  return out;
}

/** What `look` does to a picture `width` pixels wide, with the lengths scaled. */
export function partsFor(look: Look, width: number): LookParts {
  return scaleParts(look.parts, lengthScale(width));
}

/** The presentation with the look's parts laid over it, switched on. */
export function applyLook(presentation: Presentation, look: Look, width: number): Presentation {
  const parts = partsFor(look, width);
  const next: Presentation = { ...presentation, enabled: true };
  for (const key of Object.keys(parts) as LookPart[]) {
    if (parts[key] !== undefined) (next as Record<string, unknown>)[key] = parts[key];
  }
  if (parts.padding) {
    const p = parts.padding;
    next.autoBalance = p.top === p.right && p.right === p.bottom && p.bottom === p.left;
  }
  return next;
}

/** A look from the current settings: only `include`d parts, lengths scaled back to the 1280 px reference. */
export function lookFromPresentation(
  presentation: Presentation,
  include: readonly LookPart[],
  width: number,
  name: string,
  id: string,
): Look {
  const k = 1 / lengthScale(width);
  const picked: LookParts = {};
  for (const part of include) (picked as Record<string, unknown>)[part] = presentation[part];
  return { id, name, parts: scaleParts(structuredClone(picked), k) };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Whether every part of the look is what the presentation has now (so the gallery can mark it). */
export function lookMatches(presentation: Presentation, look: Look, width: number): boolean {
  if (!presentation.enabled) return false;
  const parts = partsFor(look, width);
  const keys = Object.keys(parts) as LookPart[];
  return keys.length > 0 && keys.every((key) => same(presentation[key], parts[key]));
}

const gradient = (angle: number, ...stops: [number, string][]): Background => ({
  type: "gradient",
  angle,
  stops: stops.map(([offset, color]) => ({ offset, color })),
});

/** The built-in looks of the gallery: backgrounds made in code. */
export const BUILTIN_LOOKS: readonly Look[] = [
  {
    id: "midnight",
    name: "Midnight",
    parts: { background: gradient(160, [0, "#0F172A"], [1, "#1E293B"]) },
  },
  {
    id: "citrus",
    name: "Citrus",
    parts: { background: gradient(150, [0, "#C8FF2E"], [0.6, "#84CC16"], [1, "#16A34A"]) },
  },
  {
    id: "paper",
    name: "Paper",
    parts: { background: gradient(180, [0, "#F4F4F5"], [1, "#E4E4E7"]) },
  },
  {
    id: "sunset",
    name: "Sunset",
    parts: { background: gradient(135, [0, "#FB923C"], [0.55, "#F43F5E"], [1, "#EC4899"]) },
  },
  {
    id: "ocean",
    name: "Ocean",
    parts: { background: gradient(150, [0, "#38BDF8"], [0.5, "#2563EB"], [1, "#1E3A8A"]) },
  },
  {
    id: "aurora",
    name: "Aurora",
    parts: {
      background: {
        type: "mesh",
        seed: 7,
        colors: [
          "#0B1B3A",
          "#1D4ED8",
          "#22C55E",
          "#0EA5E9",
          "#0F766E",
          "#84CC16",
          "#312E81",
          "#2563EB",
          "#14B8A6",
        ],
        smoothness: 0.7,
      },
    },
  },
];

export const builtinById = (id: string): Look | null =>
  BUILTIN_LOOKS.find((l) => l.id === id) ?? null;

/** A shadow tuned to a look's background (the "auto" colour of the shadow control). */
export function tintedShadow(presentation: Presentation): Presentation["shadow"] {
  const alpha = parseInt(presentation.shadow.color.slice(7, 9) || "ff", 16) / 255;
  return { ...presentation.shadow, color: shadowTint(presentation.background, alpha) };
}

/** The settings a look is shown on in thumbnails: the look's own parts over a neutral window. */
export function previewPresentation(look: Look, width = 640): Presentation {
  const base: Presentation = {
    ...defaultPresentation(),
    enabled: true,
    padding: { top: 48, right: 48, bottom: 48, left: 48 },
    cornerRadius: 12,
    shadow: { enabled: true, x: 0, y: 14, blur: 36, spread: 0, color: "#00000055" },
  };
  return applyLook(base, look, width);
}
