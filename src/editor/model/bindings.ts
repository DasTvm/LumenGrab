import type { Layer } from "@/document/schema";
import { DEFAULT_OPTIONS, dashFor, type ToolId, type ToolOptions } from "../ui/tools";
import { redactStrengthPercent, redactStrengthPx } from "./style";

/** The tools whose panel has options (everything except Select and Crop). */
export type StyleTool = keyof ToolOptions;

export const isStyleTool = (tool: ToolId): tool is StyleTool =>
  tool !== "select" && tool !== "crop";

const LAYER_TYPE: Record<StyleTool, string> = {
  arrow: "arrow",
  line: "line",
  rect: "rect",
  ellipse: "ellipse",
  text: "text",
  counter: "counter",
  highlighter: "highlighter",
  pencil: "pencil",
  spotlight: "spotlight",
  redact: "redaction",
};

/** True if the layer is one the panel of `tool` edits. */
export const layerIsOf = (tool: StyleTool, layer: Layer): boolean =>
  layer.type === LAYER_TYPE[tool];

const num = (layer: Layer, key: string, fallback: number): number => {
  const v = layer[key];
  return typeof v === "number" ? v : fallback;
};
const str = (layer: Layer, key: string, fallback: string): string => {
  const v = layer[key];
  return typeof v === "string" ? v : fallback;
};
const nullableColor = (layer: Layer, key: string): string | null => {
  const v = layer[key];
  return typeof v === "string" ? v : null;
};

/**
 * What the panel shows for a layer: the tool's option object read back from the layer, so selecting a
 * layer and selecting nothing use the same controls. Fields a layer lacks fall back to the defaults.
 */
export function optionsFromLayer<K extends StyleTool>(tool: K, layer: Layer): ToolOptions[K] {
  const d = DEFAULT_OPTIONS;
  switch (tool) {
    case "arrow":
      return {
        style: str(layer, "style", d.arrow.style),
        color: str(layer, "color", d.arrow.color),
        width: num(layer, "width", d.arrow.width),
      } as ToolOptions[K];
    case "line":
      return {
        color: str(layer, "color", d.line.color),
        width: num(layer, "width", d.line.width),
        dashed: Array.isArray(layer["dash"]) && layer["dash"].length > 0,
      } as ToolOptions[K];
    case "rect":
      return {
        stroke: nullableColor(layer, "stroke") ?? d.rect.stroke,
        fill: nullableColor(layer, "fill"),
        strokeWidth: num(layer, "strokeWidth", d.rect.strokeWidth),
        radius: num(layer, "radius", d.rect.radius),
      } as ToolOptions[K];
    case "ellipse":
      return {
        stroke: nullableColor(layer, "stroke") ?? d.ellipse.stroke,
        fill: nullableColor(layer, "fill"),
        strokeWidth: num(layer, "strokeWidth", d.ellipse.strokeWidth),
      } as ToolOptions[K];
    case "text":
      return {
        fontId: str(layer, "fontId", "inter"),
        size: num(layer, "size", d.text.size),
        weight: num(layer, "weight", d.text.weight),
        color: str(layer, "color", d.text.color),
        background: nullableColor(layer, "background"),
        align: str(layer, "align", "left"),
      } as ToolOptions[K];
    case "counter":
      return {
        color: str(layer, "color", d.counter.color),
        size: num(layer, "size", d.counter.size),
      } as ToolOptions[K];
    case "highlighter":
      return {
        color: str(layer, "color", d.highlighter.color),
        opacity: num(layer, "opacity", d.highlighter.opacity),
      } as ToolOptions[K];
    case "pencil":
      return {
        color: str(layer, "color", d.pencil.color),
        width: num(layer, "width", d.pencil.width),
        smoothing: num(layer, "smoothing", d.pencil.smoothing),
      } as ToolOptions[K];
    case "spotlight":
      return {
        shape: str(layer, "shape", "rect"),
        dimOpacity: num(layer, "dimOpacity", d.spotlight.dimOpacity),
      } as ToolOptions[K];
    case "redact": {
      const mode = str(layer, "mode", "blur") as ToolOptions["redact"]["mode"];
      return {
        mode,
        strength:
          mode === "solid"
            ? d.redact.strength
            : redactStrengthPercent(mode, num(layer, "strength", 0)),
        color: str(layer, "color", d.redact.color),
      } as ToolOptions[K];
    }
  }
}

/** Writes changed options into a layer (an immer draft). The inverse of `optionsFromLayer`. */
export function applyOptions<K extends StyleTool>(
  tool: K,
  layer: Layer,
  change: Partial<ToolOptions[K]>,
): void {
  const c = change as Record<string, unknown>;
  switch (tool) {
    case "line": {
      if ("dashed" in c) {
        const width = c["width"] ?? layer["width"];
        if (c["dashed"]) layer["dash"] = dashFor(Number(width));
        else delete layer["dash"];
      }
      if ("color" in c) layer["color"] = c["color"];
      if ("width" in c) {
        layer["width"] = c["width"];
        // A dashed line keeps its rhythm relative to its width.
        if (Array.isArray(layer["dash"]) && layer["dash"].length > 0) {
          layer["dash"] = dashFor(Number(c["width"]));
        }
      }
      return;
    }
    case "rect":
    case "ellipse":
      for (const [k, v] of Object.entries(c)) layer[k] = v;
      return;
    case "redact": {
      const before = optionsFromLayer("redact", layer);
      const mode = (c["mode"] as typeof before.mode | undefined) ?? before.mode;
      const percent = (c["strength"] as number | undefined) ?? before.strength;
      if ("mode" in c || "strength" in c) {
        layer["mode"] = mode;
        layer["strength"] = mode === "solid" ? 0 : redactStrengthPx(mode, percent);
      }
      if ("color" in c) layer["color"] = c["color"];
      if (mode === "solid" && layer["color"] === undefined) layer["color"] = before.color;
      return;
    }
    default:
      for (const [k, v] of Object.entries(c)) layer[k] = v;
  }
}
