import type { GroupLayer, Layer } from "./schema";

/** True for a group (format v2): a layer that holds other layers. */
export function isGroup(layer: Layer): layer is GroupLayer {
  return layer.type === "group" && Array.isArray((layer as { layers?: unknown }).layers);
}

export interface WalkInfo {
  /** The layer itself or one of its groups is hidden: it is not rendered. */
  hidden: boolean;
  /** The layer itself or one of its groups is locked. */
  locked: boolean;
  /** Number of groups around the layer. */
  depth: number;
}

/**
 * Visits every layer, groups included, depth first in z-order (bottom to top; a group comes before
 * its children). Hidden and locked state of the groups around a layer is passed down: a hidden group
 * hides everything inside it, redactions too (docs/FORMAT.md section 4).
 */
export function walkLayers(
  layers: readonly Layer[],
  visit: (layer: Layer, info: WalkInfo) => void,
  around: WalkInfo = { hidden: false, locked: false, depth: 0 },
): void {
  for (const layer of layers) {
    const info: WalkInfo = {
      hidden: around.hidden || layer.visible === false,
      locked: around.locked || layer.locked === true,
      depth: around.depth,
    };
    visit(layer, info);
    if (isGroup(layer)) walkLayers(layer.layers, visit, { ...info, depth: around.depth + 1 });
  }
}

/** All layers of the tree, groups included (the limit of 5000 counts them all). */
export function countLayers(layers: readonly Layer[]): number {
  let count = 0;
  walkLayers(layers, () => {
    count += 1;
  });
  return count;
}
