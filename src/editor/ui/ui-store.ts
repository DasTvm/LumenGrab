import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_OPTIONS, type ToolId, type ToolOptions } from "./tools";
import type { View } from "./view";

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
  toggleCollapsed(id: string): void;
  setPanning(panning: boolean): void;
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
    toggleCollapsed: (id) => {
      const { collapsed } = get();
      set({
        collapsed: collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id],
      });
    },
    setPanning: (panning) => {
      set({ panning });
    },
  }));
}
