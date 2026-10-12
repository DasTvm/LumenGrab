/** `#RRGGBB` / `#RRGGBBAA` as numbers (alpha 0..1). Anything else is opaque black. */
export function parseHex(hex: string): [number, number, number, number] {
  const m = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})?$/.exec(hex);
  if (!m) return [0, 0, 0, 1];
  return [
    parseInt(m[1] ?? "0", 16),
    parseInt(m[2] ?? "0", 16),
    parseInt(m[3] ?? "0", 16),
    m[4] ? parseInt(m[4], 16) / 255 : 1,
  ];
}

export function toHex([r, g, b]: readonly [number, number, number]): string {
  const part = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}
