import {
  applyPatches,
  current,
  enablePatches,
  isDraft,
  produceWithPatches,
  type Patch,
} from "immer";
import { createStore, type StoreApi } from "zustand/vanilla";
import { isGroup } from "@/document/layers";
import type { Layer, Project } from "@/document/schema";
import { translateLayer } from "./geometry";
import {
  bringToFront,
  cloneWithNewIds,
  groupLayers,
  insertLayer,
  locate,
  moveLayers,
  normalizeSelection,
  removeLayer,
  sendToBack,
  stepLayers,
  ungroupLayer,
} from "./tree";

enablePatches();

/** Undo steps kept (plan: 200). */
export const MAX_HISTORY = 200;

/** How far a duplicate is moved so it can be told from the original, in image pixels. */
const DUPLICATE_OFFSET = 12;

export interface EditorState {
  project: Project;
  /** Ids of the selected layers, in z-order, never a layer and its own group together. */
  selection: string[];
  canUndo: boolean;
  canRedo: boolean;
  /** Changed since the last `markSaved` (or since opening). */
  dirty: boolean;
}

export interface EditorActions {
  /**
   * Changes the project in one undo step (or as part of the running gesture). `recipe` gets an immer
   * draft. A recipe that changes nothing leaves no step and does not make the document dirty.
   */
  change(recipe: (project: Project) => void, options?: { select?: readonly string[] }): void;
  /** A drag or a stroke is one undo step however many `change` calls it makes. */
  beginGesture(): void;
  endGesture(): void;
  /** Puts everything back as it was when the gesture began (Esc while dragging). */
  cancelGesture(): void;
  undo(): void;
  redo(): void;
  select(ids: readonly string[]): void;
  markSaved(): void;

  // Layer commands. All of them skip locked layers where that matters, and select what they make.
  addLayer(layer: Layer, parentId?: string | null): void;
  deleteLayers(ids?: readonly string[]): void;
  duplicateLayers(ids?: readonly string[]): void;
  nudge(dx: number, dy: number, ids?: readonly string[]): void;
  group(ids?: readonly string[]): void;
  ungroup(ids?: readonly string[]): void;
  reorder(action: "front" | "back" | "forward" | "backward", ids?: readonly string[]): void;
  moveTo(ids: readonly string[], parentId: string | null, index?: number): void;
  rename(id: string, name: string): void;
  setVisible(id: string, visible: boolean): void;
  setLocked(id: string, locked: boolean): void;
}

export type EditorStore = EditorState & EditorActions;
export type EditorStoreApi = StoreApi<EditorStore>;

export interface EditorStoreOptions {
  /** Makes layer ids (1 to 64 characters). Tests pass a counter. */
  makeId?: () => string;
  maxHistory?: number;
}

/** A short random id for a layer. */
export function randomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 12);
}

interface Step {
  patches: Patch[];
  inverse: Patch[];
  selectionBefore: string[];
  selectionAfter: string[];
}

/**
 * The editor's state: the project, the selection and the undo history. UI-free (no React, no DOM), so
 * the whole thing is tested in plain Node. History is patch based: a step stores what changed, not
 * a copy of the project, so 200 steps of a large document stay small.
 */
export function createEditorStore(
  initial: Project,
  options: EditorStoreOptions = {},
): EditorStoreApi {
  const makeId = options.makeId ?? randomId;
  const limit = options.maxHistory ?? MAX_HISTORY;
  const undoStack: Step[] = [];
  let redoStack: Step[] = [];
  /** Where we are in the history, counted from the start; `savedAt` is where the file on disk is. */
  let cursor = 0;
  let savedAt: number | null = 0;
  let gesture: {
    steps: { patches: Patch[]; inverse: Patch[] }[];
    selectionBefore: string[];
    projectBefore: Project;
  } | null = null;

  const store = createStore<EditorStore>()((set, get) => {
    const flags = () => ({
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
      dirty: cursor !== savedAt || (gesture?.steps.length ?? 0) > 0,
    });

    const change: EditorActions["change"] = (recipe, opts) => {
      const state = get();
      const [next, patches, inverse] = produceWithPatches(state.project, (draft) => {
        recipe(draft);
      });
      const selection = opts?.select
        ? normalizeSelection(next.layers, opts.select)
        : normalizeSelection(next.layers, state.selection);
      if (patches.length === 0) return;
      if (gesture) {
        gesture.steps.push({ patches, inverse });
        set({ project: next, selection, ...flags() });
        return;
      }
      undoStack.push({
        patches,
        inverse,
        selectionBefore: state.selection,
        selectionAfter: selection,
      });
      if (undoStack.length > limit) undoStack.shift();
      redoStack = [];
      cursor += 1;
      if (savedAt !== null && savedAt >= cursor) savedAt = null; // the saved state was redone away
      set({ project: next, selection, ...flags() });
    };

    /** Locked layers (or layers in a locked group) are not changed by commands. */
    const editable = (ids: readonly string[] | undefined): string[] => {
      const { project, selection } = get();
      return normalizeSelection(project.layers, ids ?? selection).filter((id) => {
        const found = locate(project.layers, id);
        return found && !found.layer.locked && !found.ancestors.some((a) => a.locked);
      });
    };

    return {
      project: initial,
      selection: [],
      canUndo: false,
      canRedo: false,
      dirty: false,

      change,

      beginGesture() {
        if (gesture) return;
        gesture = { steps: [], selectionBefore: get().selection, projectBefore: get().project };
      },
      endGesture() {
        const g = gesture;
        gesture = null;
        if (!g || g.steps.length === 0) {
          set(flags());
          return;
        }
        // One step: apply the patches in order; undo applies the inverses in the opposite order.
        undoStack.push({
          patches: g.steps.flatMap((s) => s.patches),
          inverse: g.steps.reduceRight<Patch[]>((all, s) => [...all, ...s.inverse], []),
          selectionBefore: g.selectionBefore,
          selectionAfter: get().selection,
        });
        if (undoStack.length > limit) undoStack.shift();
        redoStack = [];
        cursor += 1;
        if (savedAt !== null && savedAt >= cursor) savedAt = null;
        set(flags());
      },
      cancelGesture() {
        const g = gesture;
        gesture = null;
        if (!g) return;
        set({ project: g.projectBefore, selection: g.selectionBefore, ...flags() });
      },

      undo() {
        if (gesture) return;
        const step = undoStack.pop();
        if (!step) return;
        const project = applyPatches(get().project, step.inverse);
        redoStack.push(step);
        cursor -= 1;
        set({
          project,
          selection: normalizeSelection(project.layers, step.selectionBefore),
          ...flags(),
        });
      },
      redo() {
        if (gesture) return;
        const step = redoStack.pop();
        if (!step) return;
        const project = applyPatches(get().project, step.patches);
        undoStack.push(step);
        cursor += 1;
        set({
          project,
          selection: normalizeSelection(project.layers, step.selectionAfter),
          ...flags(),
        });
      },

      select(ids) {
        set({ selection: normalizeSelection(get().project.layers, ids) });
      },
      markSaved() {
        savedAt = cursor;
        set(flags());
      },

      addLayer(layer, parentId = null) {
        change(
          (p) => {
            insertLayer(p.layers, layer, parentId);
          },
          { select: [layer.id] },
        );
      },
      deleteLayers(ids) {
        const doomed = editable(ids);
        if (doomed.length === 0) return;
        change(
          (p) => {
            for (const id of doomed) removeLayer(p.layers, id);
          },
          { select: [] },
        );
      },
      duplicateLayers(ids) {
        const source = normalizeSelection(get().project.layers, ids ?? get().selection);
        if (source.length === 0) return;
        const copies: string[] = [];
        change(
          (p) => {
            for (const id of source) {
              const found = locate(p.layers, id);
              if (!found) continue;
              const copy = cloneWithNewIds(
                isDraft(found.layer) ? current(found.layer) : found.layer,
                makeId,
              );
              translateLayer(copy, DUPLICATE_OFFSET, DUPLICATE_OFFSET);
              if (typeof copy.name === "string" && copy.name !== "")
                copy.name = `${copy.name} copy`;
              found.siblings.splice(found.index + 1, 0, copy);
              copies.push(copy.id);
            }
          },
          { select: copies },
        );
      },
      nudge(dx, dy, ids) {
        const movable = editable(ids);
        if (movable.length === 0) return;
        change((p) => {
          for (const id of movable) {
            const found = locate(p.layers, id);
            if (found) translateLayer(found.layer, dx, dy);
          }
        });
      },
      group(ids) {
        const members = editable(ids);
        if (members.length === 0) return;
        const groupId = makeId();
        change(
          (p) => {
            groupLayers(p.layers, members, groupId);
          },
          { select: [groupId] },
        );
      },
      ungroup(ids) {
        const groups = editable(ids).filter((id) => {
          const layer = locate(get().project.layers, id)?.layer;
          return layer ? isGroup(layer) : false;
        });
        if (groups.length === 0) return;
        const freed: string[] = []; // filled by the recipe, read afterwards for the selection
        change(
          (p) => {
            for (const id of groups) freed.push(...ungroupLayer(p.layers, id));
          },
          { select: freed },
        );
      },
      reorder(action, ids) {
        const targets = editable(ids);
        if (targets.length === 0) return;
        change((p) => {
          const layers = p.layers;
          if (action === "front") bringToFront(layers, targets);
          else if (action === "back") sendToBack(layers, targets);
          else stepLayers(layers, targets, action === "forward" ? 1 : -1);
        });
      },
      moveTo(ids, parentId, index) {
        const targets = editable(ids);
        if (targets.length === 0) return;
        change((p) => {
          moveLayers(p.layers, targets, parentId, index);
        });
      },
      rename(id, name) {
        const trimmed = name.trim().slice(0, 200);
        change((p) => {
          const layer = locate(p.layers, id)?.layer;
          if (!layer) return;
          if (trimmed === "") delete layer.name;
          else layer.name = trimmed;
        });
      },
      setVisible(id, visible) {
        change((p) => {
          const layer = locate(p.layers, id)?.layer;
          if (layer) layer.visible = visible;
        });
      },
      setLocked(id, locked) {
        change((p) => {
          const layer = locate(p.layers, id)?.layer;
          if (layer) layer.locked = locked;
        });
      },
    };
  });
  return store;
}
