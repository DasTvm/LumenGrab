import type { Os } from "./types";

const MAC_GLYPHS: Record<string, string> = { Ctrl: "⌃", Shift: "⇧", Alt: "⌥", Cmd: "⌘" };

/** How a key name is shown on a keycap: symbols on macOS, words elsewhere. */
export function formatKey(key: string, os: Os): string {
  return os === "macos" ? (MAC_GLYPHS[key] ?? key) : key;
}

/** Screen reader text for a whole shortcut: "Control Shift 4". */
export function spokenShortcut(keys: readonly string[]): string {
  return keys.map((k) => (k === "Ctrl" ? "Control" : k)).join(" ");
}
