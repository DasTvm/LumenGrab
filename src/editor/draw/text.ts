import { DEFAULT_FONT_ID } from "@/document/limits";

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

/** Bundled fonts by `fontId`; an unknown id uses the default (docs/FORMAT.md section 8). */
const FAMILIES: Record<string, string> = {
  inter: '"Inter Variable", Inter, system-ui, sans-serif',
  "jetbrains-mono": '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace',
};

export function fontFamily(fontId: string): string {
  return FAMILIES[fontId] ?? (FAMILIES[DEFAULT_FONT_ID] as string);
}

export function fontString(fontId: string, weight: number, size: number): string {
  return `${String(weight)} ${String(size)}px ${fontFamily(fontId)}`;
}
