import type { Presentation } from "@/document/schema";

/**
 * The aspect choices of the panel: the basic ratios and the social formats. A social format stores its
 * exact pixel size in the document (`aspect.size`); the sizes are the platforms' recommendations at the
 * time of writing and can change, so the list is data, not logic.
 */
type Aspect = Presentation["aspect"];

export interface BasicAspect {
  id: string;
  label: string;
  /** `null` for Auto (the shape of the picture). */
  ratio: [number, number] | null;
}

export const BASIC_ASPECTS: readonly BasicAspect[] = [
  { id: "auto", label: "Auto", ratio: null },
  { id: "1:1", label: "1:1", ratio: [1, 1] },
  { id: "4:3", label: "4:3", ratio: [4, 3] },
  { id: "3:2", label: "3:2", ratio: [3, 2] },
  { id: "16:9", label: "16:9", ratio: [16, 9] },
  { id: "2:1", label: "2:1", ratio: [2, 1] },
  { id: "4:5", label: "4:5", ratio: [4, 5] },
  { id: "3:4", label: "3:4", ratio: [3, 4] },
  { id: "9:16", label: "9:16", ratio: [9, 16] },
  { id: "1.91:1", label: "1.91:1", ratio: [1.91, 1] },
  { id: "5:4", label: "5:4", ratio: [5, 4] },
];

/** Zones that an app covers with its own buttons, as fractions of the picture. */
export interface SafeArea {
  top: number;
  bottom: number;
  left: number;
  right: number;
  topLabel?: string;
  bottomLabel?: string;
}

export interface SocialPreset {
  /** Stored in `aspect.preset`. */
  id: string;
  platform: string;
  label: string;
  size: [number, number];
  safeArea?: SafeArea;
}

const STORY: SafeArea = {
  top: 0.13,
  bottom: 0.18,
  left: 0,
  right: 0,
  topLabel: "Top bar of the app",
  bottomLabel: "Reply bar of the app",
};
const VIDEO: SafeArea = {
  top: 0.1,
  bottom: 0.2,
  left: 0,
  right: 0.12,
  topLabel: "Search and tabs",
  bottomLabel: "Caption and buttons",
};

export const SOCIAL_PRESETS: readonly SocialPreset[] = [
  { id: "instagram-square", platform: "Instagram", label: "Post · square", size: [1080, 1080] },
  { id: "instagram-portrait", platform: "Instagram", label: "Post · portrait", size: [1080, 1350] },
  {
    id: "instagram-story",
    platform: "Instagram",
    label: "Story / Reel",
    size: [1080, 1920],
    safeArea: STORY,
  },
  { id: "tiktok-video", platform: "TikTok", label: "Video", size: [1080, 1920], safeArea: VIDEO },
  { id: "x-post", platform: "X", label: "Post image", size: [1600, 900] },
  { id: "x-header", platform: "X", label: "Header", size: [1500, 500] },
  { id: "linkedin-link", platform: "LinkedIn", label: "Link post", size: [1200, 627] },
  { id: "linkedin-square", platform: "LinkedIn", label: "Square post", size: [1200, 1200] },
  { id: "facebook-link", platform: "Facebook", label: "Link post", size: [1200, 630] },
  {
    id: "facebook-story",
    platform: "Facebook",
    label: "Story",
    size: [1080, 1920],
    safeArea: STORY,
  },
  { id: "youtube-thumbnail", platform: "YouTube", label: "Thumbnail", size: [1280, 720] },
  { id: "pinterest-pin", platform: "Pinterest", label: "Pin", size: [1000, 1500] },
  { id: "web-og", platform: "Web", label: "Open Graph image", size: [1200, 630] },
  { id: "web-hero", platform: "Web", label: "Hero · 16:9", size: [1920, 1080] },
];

/** The platforms in the order of the list, each with its presets. */
export function socialGroups(): { platform: string; presets: SocialPreset[] }[] {
  const out: { platform: string; presets: SocialPreset[] }[] = [];
  for (const preset of SOCIAL_PRESETS) {
    const group = out.find((g) => g.platform === preset.platform);
    if (group) group.presets.push(preset);
    else out.push({ platform: preset.platform, presets: [preset] });
  }
  return out;
}

export const socialById = (id: string | undefined): SocialPreset | null =>
  SOCIAL_PRESETS.find((p) => p.id === id) ?? null;

/** The aspect setting for a social preset. */
export function aspectOfSocial(preset: SocialPreset): Aspect {
  return {
    mode: "fixed",
    ratio: [preset.size[0], preset.size[1]],
    size: preset.size,
    preset: preset.id,
  };
}

export function aspectOfBasic(basic: BasicAspect): Aspect {
  return basic.ratio ? { mode: "fixed", ratio: basic.ratio } : { mode: "free" };
}

export function aspectOfCustom(width: number, height: number): Aspect {
  return { mode: "fixed", ratio: [width, height] };
}

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** Which choice the aspect setting is: a social preset, a basic ratio, `auto`, or `custom`. */
export function describeAspect(
  aspect: Aspect,
): { kind: "social"; preset: SocialPreset } | { kind: "basic"; id: string } {
  const social = aspect.size ? socialById(aspect.preset) : null;
  if (
    social &&
    aspect.size &&
    social.size[0] === aspect.size[0] &&
    social.size[1] === aspect.size[1]
  )
    return { kind: "social", preset: social };
  if (aspect.mode === "free" || !aspect.ratio) return { kind: "basic", id: "auto" };
  const [w, h] = aspect.ratio;
  if (!aspect.size) {
    const hit = BASIC_ASPECTS.find((b) => b.ratio && near(b.ratio[0] / b.ratio[1], w / h));
    if (hit) return { kind: "basic", id: hit.id };
  }
  return { kind: "basic", id: "custom" };
}

/** `16:9`, `Auto`, `Instagram · Story / Reel 9:16`: the value shown beside the section title. */
export function aspectLabel(aspect: Aspect): string {
  const d = describeAspect(aspect);
  if (d.kind === "social") return `${d.preset.platform} · ${d.preset.label}`;
  if (d.id === "auto") return "Auto";
  if (d.id === "custom" && aspect.ratio)
    return `${String(aspect.ratio[0])}:${String(aspect.ratio[1])}`;
  return d.id;
}

/** Parses "16:9", "16 : 9" or "1.91/1" into a ratio; null if it is not two positive numbers. */
export function parseRatio(text: string): [number, number] | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*[:/x×]\s*(\d+(?:[.,]\d+)?)\s*$/.exec(text);
  if (!m) return null;
  const w = Number((m[1] ?? "").replace(",", "."));
  const h = Number((m[2] ?? "").replace(",", "."));
  if (!(w > 0) || !(h > 0) || w > 1000 || h > 1000) return null;
  return [w, h];
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** `9:16`, `4:5`, or `1.91:1` when the sides do not reduce to small numbers. */
export function ratioLabel(width: number, height: number): string {
  const d = gcd(width, height);
  const w = width / d;
  const h = height / d;
  return w <= 21 && h <= 21
    ? `${String(w)}:${String(h)}`
    : `${String(+(width / height).toFixed(2))}:1`;
}
