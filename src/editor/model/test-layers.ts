import type { GroupLayer, Layer, Project } from "@/document/schema";
import { defaultProject } from "@/document/write";

/** Small layer builders for tests. */
const base = (id: string) => ({ id, visible: true, locked: false });

export const rect = (id: string, x = 0, y = 0, width = 10, height = 10): Layer => ({
  ...base(id),
  type: "rect",
  x,
  y,
  width,
  height,
  rotation: 0,
  stroke: "#000000",
  fill: null,
  strokeWidth: 2,
  radius: 0,
});

export const filledRect = (id: string, x = 0, y = 0, width = 10, height = 10): Layer => ({
  ...rect(id, x, y, width, height),
  fill: "#FF0000",
});

export const counter = (id: string, value: number, x = 0, y = 0): Layer => ({
  ...base(id),
  type: "counter",
  x,
  y,
  value,
  color: "#EF4444",
  size: 20,
});

export const arrow = (id: string, from = { x: 0, y: 0 }, to = { x: 10, y: 0 }): Layer => ({
  ...base(id),
  type: "arrow",
  from,
  to,
  style: "straight",
  color: "#EF4444",
  width: 2,
});

export const redaction = (id: string, x = 0, y = 0, width = 10, height = 10): Layer => ({
  ...base(id),
  type: "redaction",
  mode: "pixelate",
  rect: { x, y, width, height },
  strength: 6,
  seed: 1,
});

export const group = (
  id: string,
  layers: Layer[],
  extra: Partial<GroupLayer> = {},
): GroupLayer => ({
  ...base(id),
  type: "group",
  layers,
  ...extra,
});

export function projectWith(layers: Layer[]): Project {
  return { ...defaultProject(), layers };
}

/** An id factory that counts: n1, n2, ... */
export function counterIds(prefix = "n"): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}${String(n)}`;
  };
}

export const ids = (layers: readonly Layer[]): string[] => layers.map((l) => l.id);
