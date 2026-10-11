import { useSyncExternalStore } from "react";
import { parseHex } from "./color-math";

/**
 * The user's own colours (the ones they always use, or that work for their eyes). Kept in the WebView's
 * local storage, which all LumenGrab windows share, so a colour saved in one editor is there in the next.
 */
const KEY = "lumengrab.savedColors";
export const MAX_SAVED_COLORS = 24;
const EVENT = "lumengrab-saved-colors";

const EMPTY: readonly string[] = [];
let cache: { raw: string | null; list: readonly string[] } = { raw: null, list: EMPTY };

/** Reads the list; a damaged value is an empty list, never an error. */
export function parseSaved(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    for (const item of value) {
      const hex = typeof item === "string" ? parseHex(item) : null;
      if (hex) seen.add(hex);
    }
    return [...seen].slice(0, MAX_SAVED_COLORS);
  } catch {
    return [];
  }
}

function read(): readonly string[] {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return EMPTY;
  }
  // Same text, same array: React compares snapshots by identity.
  if (raw !== cache.raw) cache = { raw, list: parseSaved(raw) };
  return cache.list;
}

function write(list: readonly string[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or switched off: the colour is just not remembered.
  }
  window.dispatchEvent(new Event(EVENT));
}

export const getSavedColors = (): readonly string[] => read();

/** Adds a colour at the front (an existing one moves there). Returns the new list. */
export function saveColor(hex: string): readonly string[] {
  const color = parseHex(hex);
  if (!color) return read();
  const next = [color, ...read().filter((c) => c !== color)].slice(0, MAX_SAVED_COLORS);
  write(next);
  return next;
}

export function removeSavedColor(hex: string): readonly string[] {
  const next = read().filter((c) => c !== hex);
  write(next);
  return next;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener); // another window changed it
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useSavedColors(): readonly string[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
