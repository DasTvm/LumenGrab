/** The 12 tools of the rail, in the order and groups of the design (Select, Crop | shapes | text, marks | redaction). */
export type ToolId =
  | "select"
  | "crop"
  | "arrow"
  | "line"
  | "rect"
  | "ellipse"
  | "text"
  | "highlighter"
  | "pencil"
  | "counter"
  | "spotlight"
  | "redact";

export interface ToolInfo {
  id: ToolId;
  label: string;
  /** The one-letter shortcut (no modifier). */
  key: string;
  /** Lucide icon name, from the design. */
  icon: string;
}

export const TOOL_GROUPS: readonly (readonly ToolInfo[])[] = [
  [
    { id: "select", label: "Select", key: "V", icon: "MousePointer2" },
    { id: "crop", label: "Crop", key: "C", icon: "Crop" },
  ],
  [
    { id: "arrow", label: "Arrow", key: "A", icon: "ArrowUpRight" },
    { id: "line", label: "Line", key: "L", icon: "Slash" },
    { id: "rect", label: "Rectangle", key: "R", icon: "Square" },
    { id: "ellipse", label: "Ellipse", key: "O", icon: "Circle" },
  ],
  [
    { id: "text", label: "Text", key: "T", icon: "Type" },
    { id: "highlighter", label: "Highlighter", key: "H", icon: "Highlighter" },
    { id: "pencil", label: "Pencil", key: "P", icon: "Pencil" },
    { id: "counter", label: "Counter", key: "N", icon: "Hash" },
  ],
  [
    { id: "spotlight", label: "Spotlight", key: "S", icon: "Focus" },
    { id: "redact", label: "Redaction", key: "B", icon: "EyeOff" },
  ],
];

export const TOOLS: readonly ToolInfo[] = TOOL_GROUPS.flat();

export const toolById = (id: ToolId): ToolInfo => {
  const tool = TOOLS.find((t) => t.id === id);
  if (!tool) throw new Error(`unknown tool ${id}`);
  return tool;
};

export const toolForKey = (key: string): ToolInfo | undefined =>
  TOOLS.find((t) => t.key.toLowerCase() === key.toLowerCase());

/** The colours of every palette in the design. */
export const PALETTE = [
  "#EF4444",
  "#F97316",
  "#FACC15",
  "#C8FF2E",
  "#16A34A",
  "#2563EB",
  "#18181B",
] as const;

/** What a new layer of each tool starts with (design: "Defaults for new …"). Changed by the tool's panel. */
export interface ToolOptions {
  arrow: { style: "straight" | "curved" | "outlined" | "double"; color: string; width: number };
  line: { color: string; width: number; dashed: boolean };
  rect: { stroke: string; fill: string | null; strokeWidth: number; radius: number };
  ellipse: { stroke: string; fill: string | null; strokeWidth: number };
  text: {
    fontId: "inter" | "jetbrains-mono";
    size: number;
    weight: number;
    color: string;
    background: string | null;
    align: "left" | "center" | "right";
  };
  counter: { color: string; size: number };
  highlighter: { color: string; opacity: number };
  pencil: { color: string; width: number; smoothing: number };
  spotlight: { shape: "rect" | "ellipse"; dimOpacity: number };
  redact: { mode: "blur" | "pixelate" | "solid"; strength: number; color: string };
}

export const DEFAULT_OPTIONS: ToolOptions = {
  arrow: { style: "straight", color: "#EF4444", width: 4 },
  line: { color: "#EF4444", width: 4, dashed: false },
  rect: { stroke: "#EF4444", fill: null, strokeWidth: 4, radius: 8 },
  ellipse: { stroke: "#EF4444", fill: null, strokeWidth: 4 },
  text: {
    fontId: "inter",
    size: 24,
    weight: 500,
    color: "#18181B",
    background: null,
    align: "left",
  },
  counter: { color: "#EF4444", size: 32 },
  highlighter: { color: "#FACC15", opacity: 0.4 },
  pencil: { color: "#EF4444", width: 4, smoothing: 0.6 },
  spotlight: { shape: "rect", dimOpacity: 0.6 },
  redact: { mode: "blur", strength: 14, color: "#000000" },
};

/** The dash pattern of a dashed line, in multiples of its width. */
export const dashFor = (width: number): number[] => [width * 2.5, width * 2];

/** The tool that makes a layer of this type (its panel edits it). */
export function toolForLayerType(type: string): ToolId | null {
  switch (type) {
    case "rect":
    case "ellipse":
    case "arrow":
    case "line":
    case "text":
    case "counter":
    case "highlighter":
    case "pencil":
    case "spotlight":
      return type;
    case "redaction":
      return "redact";
    default:
      return null;
  }
}
