import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_OPTIONS, type ToolId, type ToolOptions } from "./tools";
import type { View } from "./view";

/** The aspect choices of the crop panel. `custom` is a ratio taken from the lock button. */
export type CropPreset = "free" | "original" | "1:1" | "4:3" | "16:9" | "custom";

/** The crop frame while the crop tool is open (image pixels). Nothing is written to the document until Apply. */
export interface CropDraft {
  rect: { x: number; y: number; width: number; height: number };
  preset: CropPreset;
  /** `width / height` the frame is held to, or `null` for a free frame. */
  ratio: number | null;
}

export type PanelTab = "style" | "layers";

/** Short feedback in the top bar (design: Title bar states). */
export type Feedback = { kind: "saved" | "copied"; at: number } | null;

export interface UiState {
  /** The size of the canvas area in CSS pixels (set by the canvas), for zoom commands. */
  area: { width: number; height: number };
  /** The size of the source picture in pixels. */
  imageSize: { width: number; height: number };
  tool: ToolId;
  options: ToolOptions;
  /** `null` until the canvas area is measured; then the picture fitted into it. */
  view: View | null;
  /** The view follows the window size (Fit) until the user zooms or pans. */
  fit: boolean;
  tab: PanelTab;
  feedback: Feedback;
  /** Layers collapsed in the layers panel (group ids). */
  collapsed: string[];
  /** The open crop frame, `null` unless the crop tool is active. */
  crop: CropDraft | null;
  /** The text layer being typed in; `isNew` while it is a fresh box that is removed again if it stays empty. */
  editing: { id: string; isNew: boolean } | null;
  /** The number the counter tool places next after "Restart at 1"; `null` = one above the highest in the document. */
  counterNext: number | null;
  /** The pointer is held down for panning (Space) or a gesture is running: cursor hints. */
  panning: boolean;
}

export interface UiActions {
  setTool(tool: ToolId): void;
  setOption<K extends keyof ToolOptions>(tool: K, change: Partial<ToolOptions[K]>): void;
  setArea(area: { width: number; height: number }): void;
  setView(view: View, fit?: boolean): void;
  setFit(fit: boolean): void;
  setTab(tab: PanelTab): void;
  flash(kind: "saved" | "copied"): void;
  clearFeedback(at: number): void;
  toggleCollapsed(id: string): void;
  setPanning(panning: boolean): void;
  setCounterNext(value: number | null): void;
  setEditing(editing: { id: string; isNew: boolean } | null): void;
  setCrop(crop: CropDraft | null): void;
}

export type UiStore = UiState & UiActions;
export type UiStoreApi = StoreApi<UiStore>;

export function createUiStore(imageSize = { width: 1000, height: 1000 }): UiStoreApi {
  return createStore<UiStore>()((set, get) => ({
    imageSize,
    area: { width: 800, height: 600 },
    tool: "select",
    options: DEFAULT_OPTIONS,
    view: null,
    fit: true,
    tab: "style",
    feedback: null,
    collapsed: [],
    panning: false,
    counterNext: null,
    editing: null,
    crop: null,

    setTool: (tool) => {
      set({ tool });
    },
    setOption: (tool, change) => {
      set({ options: { ...get().options, [tool]: { ...get().options[tool], ...change } } });
    },
    setArea: (area) => {
      set({ area });
    },
    setView: (view, fit = false) => {
      set({ view, fit });
    },
    setFit: (fit) => {
      set({ fit });
    },
    setTab: (tab) => {
      set({ tab });
    },
    flash: (kind) => {
      set({ feedback: { kind, at: Date.now() } });
    },
    // Only the message it was started for goes away (a newer one keeps its own two seconds).
    clearFeedback: (at) => {
      if (get().feedback?.at === at) set({ feedback: null });
    },
    toggleCollapsed: (id) => {
      const { collapsed } = get();
      set({
        collapsed: collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id],
      });
    },
    setPanning: (panning) => {
      set({ panning });
    },
    setCounterNext: (counterNext) => {
      set({ counterNext });
    },
    setEditing: (editing) => {
      set({ editing });
    },
    setCrop: (crop) => {
      set({ crop });
    },
  }));
}
