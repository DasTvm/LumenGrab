import type { Presentation } from "@/document/schema";
import { lengthScale } from "./looks";

type Shadow = Presentation["shadow"];

/** The shadow presets, for a picture 1280 px wide (their lengths scale with the picture like a look's). */
export const SHADOW_PRESETS = [
  { id: "soft", label: "Soft", blur: 30, y: 10, opacity: 0.15 },
  { id: "medium", label: "Medium", blur: 40, y: 20, opacity: 0.25 },
  { id: "hard", label: "Hard", blur: 12, y: 14, opacity: 0.5 },
] as const;

export type ShadowPresetId = (typeof SHADOW_PRESETS)[number]["id"] | "custom";

const hex2 = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, "0")
    .toUpperCase();

/** The opacity (0..1) of the shadow colour. */
export function shadowOpacity(shadow: Shadow): number {
  return shadow.color.length >= 9 ? parseInt(shadow.color.slice(7, 9), 16) / 255 : 1;
}

/** The colour with a new opacity. */
export function withOpacity(color: string, opacity: number): string {
  return `${color.slice(0, 7).toUpperCase()}${hex2(opacity)}`;
}

/** The shadow of a preset for a picture `width` pixels wide; the colour keeps its tone. */
export function applyShadowPreset(
  shadow: Shadow,
  id: Exclude<ShadowPresetId, "custom">,
  width: number,
): Shadow {
  const preset = SHADOW_PRESETS.find((p) => p.id === id);
  if (!preset) return shadow;
  const k = lengthScale(width);
  return {
    ...shadow,
    enabled: true,
    x: 0,
    y: Math.round(preset.y * k * 10) / 10,
    blur: Math.round(preset.blur * k * 10) / 10,
    spread: 0,
    color: withOpacity(shadow.color, preset.opacity),
  };
}

/** Which preset the shadow is (all numbers equal, the colour tone does not matter), or `custom`. */
export function detectShadowPreset(shadow: Shadow, width: number): ShadowPresetId {
  for (const preset of SHADOW_PRESETS) {
    const wanted = applyShadowPreset(shadow, preset.id, width);
    if (
      shadow.x === wanted.x &&
      shadow.y === wanted.y &&
      shadow.blur === wanted.blur &&
      shadow.spread === wanted.spread &&
      Math.abs(shadowOpacity(shadow) - preset.opacity) < 0.01
    )
      return preset.id;
  }
  return "custom";
}
