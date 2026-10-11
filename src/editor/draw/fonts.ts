import { walkLayers } from "@/document/layers";
import type { Layer } from "@/document/schema";
import { fontString } from "./text";

/**
 * The canvas draws with whatever font is loaded at that moment, so a drawing must wait until the fonts
 * it uses are there (they are bundled, `@fontsource`, and load on first use). Browsers load a font only
 * when something asks for it: this asks.
 */
export async function ensureFonts(layers: readonly Layer[]): Promise<void> {
  if (typeof document === "undefined") return;
  const wanted = new Map<string, string>();
  walkLayers(layers, (layer) => {
    if (layer.type === "text") {
      const font = fontString(
        typeof layer["fontId"] === "string" ? layer["fontId"] : "inter",
        typeof layer["weight"] === "number" ? layer["weight"] : 400,
        16,
      );
      wanted.set(
        font,
        `${wanted.get(font) ?? ""}${typeof layer["text"] === "string" ? layer["text"] : ""}`,
      );
    } else if (layer.type === "counter") {
      wanted.set(fontString("inter", 700, 16), "0123456789-");
    }
  });
  await Promise.all([...wanted].map(([font, sample]) => document.fonts.load(font, sample || "A")));
}
