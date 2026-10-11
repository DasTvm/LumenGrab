/** Colour maths for the colour picker: hex <-> RGB <-> HSV. Pure, tested in Node. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}
/** Hue 0-360, saturation and value 0-1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * `#abc`, `abc`, `#aabbcc`, `AABBCC` -> `#AABBCC`. Anything else is `null`. (The picker is opaque: an
 * 8-digit colour keeps only its first six digits.)
 */
export function parseHex(text: string): string | null {
  const t = text.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(t)) {
    return `#${t.charAt(0)}${t.charAt(0)}${t.charAt(1)}${t.charAt(1)}${t.charAt(2)}${t.charAt(2)}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(t)) return `#${t.slice(0, 6)}`.toUpperCase();
  return null;
}

export function hexToRgb(hex: string): Rgb {
  const h = parseHex(hex) ?? "#000000";
  return {
    r: parseInt(h.slice(1, 3), 16),
    g: parseInt(h.slice(3, 5), 16),
    b: parseInt(h.slice(5, 7), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const part = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

export function rgbToHsv({ r, g, b }: Rgb): Hsv {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const hexToHsv = (hex: string): Hsv => rgbToHsv(hexToRgb(hex));
export const hsvToHex = (hsv: Hsv): string => rgbToHex(hsvToRgb(hsv));

/** The colour of a hue at full saturation and value: the track of the hue slider and the base of the square. */
export const hueColor = (h: number): string => hsvToHex({ h, s: 1, v: 1 });
