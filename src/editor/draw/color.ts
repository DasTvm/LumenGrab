/**
 * `#RRGGBB` and `#RRGGBBAA` (docs/FORMAT.md section 4) as a CSS colour. The canvas takes `rgba()` in
 * every engine, while 8-digit hex is newer than some WebViews.
 */
export function cssColor(hex: string, extraAlpha = 1): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = hex.length >= 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  const alpha = Math.round(a * extraAlpha * 1000) / 1000;
  return `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(alpha)})`;
}

/** Black or white, whichever reads better on this colour (the number inside a counter). */
export function contrastColor(hex: string): string {
  const channel = (offset: number) => {
    const v = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4 ? "#000000" : "#FFFFFF";
}
