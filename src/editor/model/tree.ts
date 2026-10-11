import { isGroup, walkLayers } from "@/document/layers";
import { MAX_GROUP_DEPTH } from "@/document/limits";
import type { GroupLayer, Layer } from "@/document/schema";

/**
 * Operations on the layer tree (format v2, docs/FORMAT.md section 4). Every function changes the
 * array it is given in place, so the store can run them on an immer draft (one undo step each) and
 * tests can run them on plain data. Index 0 is the bottom layer, like in the file.
 */

export interface Located {
  layer: Layer;
  /** The array the layer is in: the project's `layers` or a group's `layers`. */
  siblings: Layer[];
  index: number;
  /** Groups around the layer, outermost first. */
  ancestors: GroupLayer[];
}

export function locate(layers: Layer[], id: string): Located | null {
  const search = (list: Layer[], ancestors: GroupLayer[]): Located | null => {
    for (let index = 0; index < list.length; index += 1) {
      const layer = list[index];
      if (!layer) continue;
      if (layer.id === id) return { layer, siblings: list, index, ancestors };
      if (isGroup(layer)) {
        const inner = search(layer.layers, [...ancestors, layer]);
        if (inner) return inner;
      }
    }
    return null;
  };
  return search(layers, []);
}

export function findLayer(layers: readonly Layer[], id: string): Layer | null {
  return locate(layers as Layer[], id)?.layer ?? null;
}

/** All ids of the tree in z-order, bottom to top, groups before their children. */
export function allIds(layers: readonly Layer[]): string[] {
  const ids: string[] = [];
  walkLayers(layers, (layer) => ids.push(layer.id));
  return ids;
}

/** How many groups are inside each other in this subtree (a plain layer is 0, a group of plain layers 1). */
export function groupHeight(layer: Layer): number {
  if (!isGroup(layer)) return 0;
  return 1 + layer.layers.reduce((deepest, child) => Math.max(deepest, groupHeight(child)), 0);
}

/**
 * Drops ids that do not exist and ids that sit inside another selected group (the group moves them
 * already). The result is in z-order.
 */
export function normalizeSelection(layers: readonly Layer[], ids: readonly string[]): string[] {
  const wanted = new Set(ids);
  const result: string[] = [];
  const skip: GroupLayer[] = [];
  walkLayers(layers, (layer, info) => {
    while (skip.length > info.depth) skip.pop();
    if (skip.length > 0) return;
    if (wanted.has(layer.id)) {
      result.push(layer.id);
      if (isGroup(layer)) skip.push(layer);
    }
  });
  return result;
}

/** Takes a layer out of the tree. */
export function removeLayer(layers: Layer[], id: string): Layer | null {
  const found = locate(layers, id);
  if (!found) return null;
  found.siblings.splice(found.index, 1);
  return found.layer;
}

function childrenOf(layers: Layer[], parentId: string | null): Layer[] | null {
  if (parentId === null) return layers;
  const parent = locate(layers, parentId)?.layer;
  return parent && isGroup(parent) ? parent.layers : null;
}

/** Puts a layer into `parentId` (null = top level) at `index` (default: on top). */
export function insertLayer(
  layers: Layer[],
  layer: Layer,
  parentId: string | null = null,
  index?: number,
): boolean {
  const target = childrenOf(layers, parentId);
  if (!target) return false;
  const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, layer);
  return true;
}

/**
 * Moves layers (in z-order) into `parentId` at `index`, counted after they were taken out. Refuses
 * to move a group into itself or into its own children, and to nest groups deeper than the format
 * allows. Returns whether anything moved.
 */
export function moveLayers(
  layers: Layer[],
  ids: readonly string[],
  parentId: string | null,
  index?: number,
): boolean {
  const moving = normalizeSelection(layers, ids);
  if (moving.length === 0) return false;
  const parent = parentId === null ? null : locate(layers, parentId);
  if (parentId !== null && (!parent || !isGroup(parent.layer))) return false;
  const depthOfParent = parent ? parent.ancestors.length + 1 : 0;
  for (const id of moving) {
    const found = locate(layers, id);
    if (!found) return false;
    if (parentId !== null) {
      if (id === parentId || parent?.ancestors.some((a) => a.id === id)) return false;
    }
    if (depthOfParent + groupHeight(found.layer) > MAX_GROUP_DEPTH) return false;
  }
  const taken = moving.map((id) => removeLayer(layers, id)).filter((l): l is Layer => l !== null);
  const target = childrenOf(layers, parentId);
  if (!target) return false;
  const at = index === undefined ? target.length : Math.max(0, Math.min(index, target.length));
  target.splice(at, 0, ...taken);
  return true;
}

/** Brings the layers to the front of their own group (top of the stack inside it). */
export function bringToFront(layers: Layer[], ids: readonly string[]): boolean {
  return reorderWithin(layers, ids, "front");
}

export function sendToBack(layers: Layer[], ids: readonly string[]): boolean {
  return reorderWithin(layers, ids, "back");
}

/** One step up or down inside the layer's own group. */
export function stepLayers(layers: Layer[], ids: readonly string[], direction: 1 | -1): boolean {
  let changed = false;
  const normalized = normalizeSelection(layers, ids);
  const ordered = direction === 1 ? [...normalized].reverse() : normalized;
  for (const id of ordered) {
    const found = locate(layers, id);
    if (!found) continue;
    const neighbour = found.siblings[found.index + direction];
    if (!neighbour || normalized.includes(neighbour.id)) continue;
    found.siblings.splice(found.index, 1);
    found.siblings.splice(found.index + direction, 0, found.layer);
    changed = true;
  }
  return changed;
}

function reorderWithin(layers: Layer[], ids: readonly string[], where: "front" | "back"): boolean {
  const normalized = normalizeSelection(layers, ids);
  let changed = false;
  const groups = new Map<Layer[], string[]>();
  for (const id of normalized) {
    const found = locate(layers, id);
    if (found) groups.set(found.siblings, [...(groups.get(found.siblings) ?? []), id]);
  }
  for (const [siblings, members] of groups) {
    const picked = siblings.filter((l) => members.includes(l.id));
    const rest = siblings.filter((l) => !members.includes(l.id));
    const next = where === "front" ? [...rest, ...picked] : [...picked, ...rest];
    if (next.some((l, i) => l !== siblings[i])) {
      siblings.splice(0, siblings.length, ...next);
      changed = true;
    }
  }
  return changed;
}

/**
 * Wraps the layers in a new group. The group takes the place of the topmost of them; the layers keep
 * their order relative to each other. Returns the group, or `null` if there is nothing to group or the
 * result would nest groups too deep.
 */
export function groupLayers(
  layers: Layer[],
  ids: readonly string[],
  groupId: string,
): GroupLayer | null {
  const selected = normalizeSelection(layers, ids);
  if (selected.length === 0) return null;
  const top = locate(layers, selected[selected.length - 1] ?? "");
  if (!top) return null;
  const members = selected.map((id) => findLayer(layers, id)).filter((l): l is Layer => l !== null);
  const height = members.reduce((deepest, l) => Math.max(deepest, groupHeight(l)), 0);
  if (top.ancestors.length + 1 + height > MAX_GROUP_DEPTH) return null;

  const before = top.siblings.slice(0, top.index).filter((l) => selected.includes(l.id)).length;
  const insertAt = top.index - before;
  const siblings = top.siblings;
  const taken = selected.map((id) => removeLayer(layers, id)).filter((l): l is Layer => l !== null);
  const group: GroupLayer = {
    id: groupId,
    type: "group",
    visible: true,
    locked: false,
    layers: taken,
  };
  siblings.splice(insertAt, 0, group);
  return group;
}

/** Replaces a group with its children, at the same place. Returns the children's ids. */
export function ungroupLayer(layers: Layer[], id: string): string[] {
  const found = locate(layers, id);
  if (!found || !isGroup(found.layer)) return [];
  const children = found.layer.layers;
  found.siblings.splice(found.index, 1, ...children);
  return children.map((c) => c.id);
}

/** A deep copy with new ids (a group's children get new ids too). `makeId` is called once per layer. */
export function cloneWithNewIds<T extends Layer>(layer: T, makeId: () => string): T {
  const copy = structuredClone(layer) as Layer;
  walkLayers([copy], (l) => {
    l.id = makeId();
  });
  return copy as T;
}
