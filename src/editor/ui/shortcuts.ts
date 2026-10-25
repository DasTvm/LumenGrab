import { toolForKey, type ToolId } from "./tools";

export type EditorCommand =
  | { type: "undo" }
  | { type: "redo" }
  | { type: "delete" }
  | { type: "duplicate" }
  | { type: "group" }
  | { type: "ungroup" }
  | { type: "front" }
  | { type: "back" }
  | { type: "forward" }
  | { type: "backward" }
  | { type: "selectAll" }
  | { type: "deselect" }
  | { type: "nudge"; dx: number; dy: number }
  | { type: "tool"; tool: ToolId }
  | { type: "fit" }
  | { type: "zoom100" }
  | { type: "zoomIn" }
  | { type: "zoomOut" }
  | { type: "save" }
  | { type: "saveAs" }
  | { type: "export" }
  | { type: "copy" }
  | { type: "copyText" }
  | { type: "toggleMode" };

export interface KeyInfo {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/**
 * What a key press means in the editor (the tooltips, the context menu of the layers panel and the
 * design say the same shortcuts). `mac` decides whether Cmd or Ctrl is the command key. A letter
 * without a modifier picks a tool. Pure, so every shortcut is tested.
 */
export function commandForKey(e: KeyInfo, mac: boolean): EditorCommand | null {
  const mod = mac ? e.metaKey : e.ctrlKey;
  const other = mac ? e.ctrlKey : e.metaKey;
  if (other) return null;
  const key = e.key.toLowerCase();

  if (mod) {
    if (e.altKey && key !== "g") return null;
    if (key === "z") return e.shiftKey ? { type: "redo" } : { type: "undo" };
    if (key === "y" && !mac) return { type: "redo" };
    if (key === "d") return { type: "duplicate" };
    if (key === "g") return e.shiftKey ? { type: "ungroup" } : { type: "group" };
    if (key === "a") return { type: "selectAll" };
    if (key === "s") return e.shiftKey ? { type: "saveAs" } : { type: "save" };
    if (key === "e") return { type: "export" };
    if (key === "c" && e.shiftKey) return { type: "copy" };
    if (key === "t" && e.shiftKey) return { type: "copyText" };
    if (key === "p" && e.shiftKey) return { type: "toggleMode" };
    if (e.code === "BracketRight") return e.shiftKey ? { type: "front" } : { type: "forward" };
    if (e.code === "BracketLeft") return e.shiftKey ? { type: "back" } : { type: "backward" };
    if (key === "0") return { type: "fit" };
    if (key === "1") return { type: "zoom100" };
    if (key === "=" || key === "+") return { type: "zoomIn" };
    if (key === "-") return { type: "zoomOut" };
    return null;
  }

  switch (e.key) {
    case "Delete":
    case "Backspace":
      return { type: "delete" };
    case "Escape":
      return { type: "deselect" };
    case "ArrowLeft":
      return { type: "nudge", dx: e.shiftKey ? -10 : -1, dy: 0 };
    case "ArrowRight":
      return { type: "nudge", dx: e.shiftKey ? 10 : 1, dy: 0 };
    case "ArrowUp":
      return { type: "nudge", dx: 0, dy: e.shiftKey ? -10 : -1 };
    case "ArrowDown":
      return { type: "nudge", dx: 0, dy: e.shiftKey ? 10 : 1 };
  }
  if (e.altKey || e.shiftKey || e.key.length !== 1) return null;
  const tool = toolForKey(e.key);
  return tool ? { type: "tool", tool: tool.id } : null;
}
