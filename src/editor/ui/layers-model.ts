import { isGroup } from "@/document/layers";
import type { GroupLayer, Layer } from "@/document/schema";
import { locate } from "../model/tree";

/** One row of the layers panel. The list shows the front layer first, like the design ("top of the list is in front"). */
export interface Row {
  layer: Layer;
  depth: number;
  /** The group the layer is in, or `null` at the top. */
  parentId: string | null;
  /** The layer is hidden, or inside a hidden group. */
  dimmed: boolean;
  /** The layer is locked, or inside a locked group. */
  locked: boolean;
  isGroup: boolean;
  collapsed: boolean;
  /** Layers inside a group (all depths), for the badge on a collapsed one. */
  count: number;
}

function countInside(group: GroupLayer): number {
  return group.layers.reduce((n, l) => n + 1 + (isGroup(l) ? countInside(l) : 0), 0);
}

/** The rows to show: front to back, groups followed by their children unless collapsed. */
export function buildRows(layers: readonly Layer[], collapsed: readonly string[]): Row[] {
  const rows: Row[] = [];
  const visit = (
    list: readonly Layer[],
    depth: number,
    parentId: string | null,
    hidden: boolean,
    locked: boolean,
  ) => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      const layer = list[i];
      if (!layer) continue;
      const group = isGroup(layer);
      const isCollapsed = group && collapsed.includes(layer.id);
      const dimmed = hidden || layer.visible === false;
      const lockedNow = locked || layer.locked === true;
      rows.push({
        layer,
        depth,
        parentId,
        dimmed,
        locked: lockedNow,
        isGroup: group,
        collapsed: isCollapsed,
        count: group ? countInside(layer) : 0,
      });
      if (group && !isCollapsed) visit(layer.layers, depth + 1, layer.id, dimmed, lockedNow);
    }
  };
  visit(layers, 0, null, false, false);
  return rows;
}

export type DropPosition = "above" | "below" | "inside";

export interface DropTarget {
  parentId: string | null;
  /** Index among the target's children after the moved layers were taken out (0 = back). */
  index: number;
}

/**
 * Where dragged layers land when dropped on a row. `above` puts them in front of that row's layer (in
 * its group), `below` behind it, `inside` at the front of a group. Returns `null` for a drop that
 * makes no sense: onto a row being moved, or a group into itself.
 */
export function dropTarget(
  layers: Layer[],
  moving: readonly string[],
  overId: string,
  position: DropPosition,
): DropTarget | null {
  if (moving.includes(overId)) return null;
  const over = locate(layers, overId);
  if (!over) return null;
  // A group cannot go into itself or one of its own groups.
  const inside = [...over.ancestors.map((a) => a.id), ...(position === "inside" ? [overId] : [])];
  if (moving.some((id) => inside.includes(id))) return null;

  if (position === "inside") {
    if (!isGroup(over.layer)) return null;
    const rest = over.layer.layers.filter((l) => !moving.includes(l.id));
    return { parentId: overId, index: rest.length };
  }
  const parentId = over.ancestors[over.ancestors.length - 1]?.id ?? null;
  const rest = over.siblings.filter((l) => !moving.includes(l.id));
  const at = rest.findIndex((l) => l.id === overId);
  return { parentId, index: position === "above" ? at + 1 : at };
}

/** Which third of a row the pointer is in: groups also accept `inside` in the middle. */
export function dropPosition(offsetY: number, height: number, canEnter: boolean): DropPosition {
  const fraction = offsetY / height;
  if (canEnter && fraction > 0.25 && fraction < 0.75) return "inside";
  return fraction < 0.5 ? "above" : "below";
}
