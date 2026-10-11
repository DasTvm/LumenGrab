import { isSystemFontId, systemFontFamily } from "@/document/limits";

/**
 * Text layout (docs/FORMAT.md "Rendering rules"), independent of the canvas: it gets a function that
 * measures a string. The editor and every export call it with the same font, so they break lines at
 * the same places.
 *
 * - Line height is 1.3 x the font size.
 * - `width: null` means the text never wraps (only explicit line breaks); a width wraps at spaces, and a
 *   word longer than the width is cut by characters.
 * - The block is as wide as `width`, or as the longest line. `align` places each line in the block.
 * - A background colour fills the block plus 0.3 x size on every side.
 */
export const LINE_HEIGHT = 1.3;
export const BACKGROUND_PADDING = 0.3;

export type MeasureWidth = (text: string) => number;

export interface TextLine {
  text: string;
  /** Distance of the line's left edge from the block's left edge. */
  offset: number;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  width: number;
  height: number;
}

export interface TextInput {
  text: string;
  width: number | null;
  size: number;
  align: string;
}

function wrap(paragraph: string, maxWidth: number, measure: MeasureWidth): string[] {
  if (paragraph === "") return [""];
  const out: string[] = [];
  let line = "";
  const flush = () => {
    out.push(line.trimEnd());
    line = "";
  };
  for (const word of paragraph.split(/(?<= )/)) {
    const trial = line + word;
    if (line === "" || measure(trial.trimEnd()) <= maxWidth) {
      line = trial;
    } else {
      flush();
      line = word;
    }
    // A single word wider than the block: cut it by characters.
    while (measure(line.trimEnd()) > maxWidth && line.length > 1) {
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut -= 1;
      out.push(line.slice(0, cut));
      line = line.slice(cut);
    }
  }
  if (line !== "") out.push(line.trimEnd());
  return out;
}

export function layoutText(input: TextInput, measure: MeasureWidth): TextLayout {
  const paragraphs = input.text.split("\n");
  const rows =
    input.width === null
      ? paragraphs
      : paragraphs.flatMap((p) => wrap(p, Math.max(1, input.width ?? 1), measure));
  const widths = rows.map((row) => measure(row));
  const width = input.width ?? Math.max(0, ...widths);
  const lines = rows.map((text, i) => {
    const w = widths[i] ?? 0;
    const offset =
      input.align === "center" ? (width - w) / 2 : input.align === "right" ? width - w : 0;
    return { text, offset, width: w };
  });
  return { lines, width, height: rows.length * input.size * LINE_HEIGHT };
}

/** The fonts that ship with the app (docs/FORMAT.md section 8), by `fontId`. */
export const BUNDLED_FONTS: readonly {
  id: string;
  label: string;
  family: string;
  fallback: string;
}[] = [
  {
    id: "inter",
    label: "Inter",
    family: "Inter Variable",
    fallback: "Inter, system-ui, sans-serif",
  },
  {
    id: "jetbrains-mono",
    label: "JetBrains Mono",
    family: "JetBrains Mono Variable",
    fallback: '"JetBrains Mono", ui-monospace, monospace',
  },
  { id: "lora", label: "Lora", family: "Lora Variable", fallback: "Georgia, serif" },
  { id: "fraunces", label: "Fraunces", family: "Fraunces Variable", fallback: "Georgia, serif" },
  {
    id: "space-grotesk",
    label: "Space Grotesk",
    family: "Space Grotesk Variable",
    fallback: "system-ui, sans-serif",
  },
  { id: "oswald", label: "Oswald", family: "Oswald Variable", fallback: "Impact, sans-serif" },
  { id: "nunito", label: "Nunito", family: "Nunito Variable", fallback: "system-ui, sans-serif" },
  { id: "caveat", label: "Caveat", family: "Caveat Variable", fallback: "cursive" },
];

const DEFAULT_STACK = '"Inter Variable", Inter, system-ui, sans-serif';

/**
 * The CSS font stack of a `fontId`. A bundled id maps to its font; `system:Family` names a font installed on
 * the device and falls back to the default font where it is missing; an unknown id is the default font.
 */
export function fontFamily(fontId: string): string {
  if (isSystemFontId(fontId)) {
    const family = systemFontFamily(fontId).replace(/["\\]/g, "");
    return `"${family}", ${DEFAULT_STACK}`;
  }
  const bundled = BUNDLED_FONTS.find((f) => f.id === fontId);
  return bundled ? `"${bundled.family}", ${bundled.fallback}` : DEFAULT_STACK;
}

export function fontString(fontId: string, weight: number, size: number): string {
  return `${String(weight)} ${String(size)}px ${fontFamily(fontId)}`;
}
