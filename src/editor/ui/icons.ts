import {
  ArrowUpRight,
  Circle,
  Crop,
  EyeOff,
  Focus,
  Hash,
  Highlighter,
  MousePointer2,
  Pencil,
  Slash,
  Square,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { ToolId } from "./tools";

export const TOOL_ICONS: Record<ToolId, LucideIcon> = {
  select: MousePointer2,
  crop: Crop,
  arrow: ArrowUpRight,
  line: Slash,
  rect: Square,
  ellipse: Circle,
  text: Type,
  highlighter: Highlighter,
  pencil: Pencil,
  counter: Hash,
  spotlight: Focus,
  redact: EyeOff,
};
