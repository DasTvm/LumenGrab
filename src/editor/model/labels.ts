import { isGroup } from "@/document/layers";
import type { Layer } from "@/document/schema";

const REDACTION_MODES = { blur: "Blur", pixelate: "Pixelate", solid: "Solid" } as const;

/** The name the layers panel shows for a layer the user has not renamed. */
export function defaultLayerName(layer: Layer): string {
  switch (layer.type) {
    case "arrow":
      return "Arrow";
    case "line":
      return "Line";
    case "rect":
      return "Rectangle";
    case "ellipse":
      return "Ellipse";
    case "text": {
      const text =
        typeof layer["text"] === "string" ? layer["text"].replace(/\s+/g, " ").trim() : "";
      if (text === "") return "Text";
      return `Text “${text.length > 24 ? `${text.slice(0, 23)}…` : text}”`;
    }
    case "counter":
      return `Counter ${String(layer["value"])}`;
    case "pencil":
      return "Pencil";
    case "highlighter":
      return "Highlighter";
    case "spotlight":
      return "Spotlight";
    case "redaction": {
      const mode = layer["mode"];
      const label =
        typeof mode === "string" && mode in REDACTION_MODES
          ? REDACTION_MODES[mode as keyof typeof REDACTION_MODES]
          : "";
      return label ? `Redaction · ${label}` : "Redaction";
    }
    case "group":
      return "Group";
    default:
      return "Layer";
  }
}

/** The user's name for a layer, or the default one. */
export function layerLabel(layer: Layer): string {
  const name = typeof layer.name === "string" ? layer.name.trim() : "";
  return name !== "" ? name : defaultLayerName(layer);
}

/** How many layers a group holds in total, for the badge on a collapsed group. */
export function groupCount(layer: Layer): number {
  if (!isGroup(layer)) return 0;
  return layer.layers.reduce((n, child) => n + 1 + groupCount(child), 0);
}
