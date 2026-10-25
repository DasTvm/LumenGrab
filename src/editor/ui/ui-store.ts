import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_OPTIONS, type ToolId, type ToolOptions } from "./tools";
import type { View } from "./view";
import type { TextState } from "./text-read";

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

/** The two modes of the editor (top bar tabs): drawing on the picture, or composing the presentation around it. */
export type EditorMode = "annotate" | "presentation";

/** A message at the bottom left of the editor ("Saved as “Client demo”", "Look deleted" with Undo). */
export interface Toast {
  id: number;
  icon: "saved" | "default" | "deleted" | "copied";
  text: string;
  action?: { label: string; run: () => void };
}

/** Where the Studio starts when it opens straight into the shader editor. */
export type StudioStart = { kind: "new-shader" } | { kind: "shader"; shaderId: string };

/** A look that could not be applied as it was saved (its background picture is gone). */
export interface LookNotice {
  lookId: string;
  lookName: string;
  message: string;
}

/** Short feedback in the top bar (design: Title bar states). */
export type Feedback = { kind: "saved" | "copied" | "pinned"; at: number } | null;

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
  mode: EditorMode;
  /** What Fit and 100 % centre on: the picture (or crop), or the whole composition in Presentation mode. Set by the canvas. */
  stage: { x: number; y: number; width: number; height: number } | null;
  /** Presentation mode: shade the zones a social app covers with its own buttons. */
  safeArea: boolean;
  feedback: Feedback;
  toasts: Toast[];
  lookNotice: LookNotice | null;
  /** Layers collapsed in the layers panel (group ids). */
  collapsed: string[];
  /** The open crop frame, `null` unless the crop tool is active. */
  crop: CropDraft | null;
  /** The Text panel: what reading the picture found. `null` while it is closed. */
  text: TextState | null;
  /** The text layer being typed in; `isNew` while it is a fresh box that is removed again if it stays empty. */
  editing: { id: string; isNew: boolean } | null;
  /** The number the counter tool places next after "Restart at 1"; `null` = one above the highest in the document. */
  counterNext: number | null;
  /** The pointer is held down for panning (Space) or a gesture is running: cursor hints. */
  panning: boolean;
  /** An animated background plays in the editor while you edit ("Animate in editor"). */
  animate: boolean;
  /** The animated look chosen last, so it stays marked while the user tunes it. */
  animatedLook: string | null;
  /** The Background Studio is open on top of the editor. */
  studio: boolean;
  /** Why the Studio was opened when it was not for the background itself: straight into the shader editor. */
  studioStart: StudioStart | null;
  /** The custom shader code of this document may run (false for a file from outside until the user allows it). */
  codeAllowed: boolean;
  /** Counts changes of what code may run, so the pictures are drawn again. */
  codeVersion: number;
}

export interface UiActions {
  setTool(tool: ToolId): void;
  setOption<K extends keyof ToolOptions>(tool: K, change: Partial<ToolOptions[K]>): void;
  setArea(area: { width: number; height: number }): void;
  setView(view: View, fit?: boolean): void;
  setFit(fit: boolean): void;
  setTab(tab: PanelTab): void;
  setMode(mode: EditorMode): void;
  setStage(stage: UiState["stage"]): void;
  setSafeArea(on: boolean): void;
  flash(kind: "saved" | "copied" | "pinned"): void;
  pushToast(toast: Omit<Toast, "id">): void;
  dismissToast(id: number): void;
  setLookNotice(notice: LookNotice | null): void;
  clearFeedback(at: number): void;
  toggleCollapsed(id: string): void;
  setPanning(panning: boolean): void;
  setCounterNext(value: number | null): void;
  setEditing(editing: { id: string; isNew: boolean } | null): void;
  setCrop(crop: CropDraft | null): void;
  setText(text: TextState | null): void;
  /** Picks a block of the read text, or lets it go. */
  toggleTextBlock(index: number): void;
  setAnimate(animate: boolean): void;
  setAnimatedLook(id: string | null): void;
  setStudio(open: boolean): void;
  /** Opens the Studio on the shader editor (a new shader, or one of My shaders), without the Studio around it. */
  openShaderEditor(start: StudioStart): void;
  setCodeAllowed(allowed: boolean): void;
  bumpCode(): void;
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
    mode: "annotate",
    stage: null,
    safeArea: false,
    feedback: null,
    toasts: [],
    lookNotice: null,
    collapsed: [],
    panning: false,
    counterNext: null,
    editing: null,
    crop: null,
    text: null,
    animate: true,
    animatedLook: null,
    studio: false,
    studioStart: null,
    codeAllowed: true,
    codeVersion: 0,

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
    setMode: (mode) => {
      set({ mode, fit: true, stage: null });
    },
    setStage: (stage) => {
      set({ stage });
    },
    setSafeArea: (safeArea) => {
      set({ safeArea });
    },
    pushToast: (toast) => {
      const id = (get().toasts.at(-1)?.id ?? 0) + 1;
      set({ toasts: [...get().toasts.slice(-2), { ...toast, id }] });
    },
    dismissToast: (id) => {
      set({ toasts: get().toasts.filter((t) => t.id !== id) });
    },
    setLookNotice: (lookNotice) => {
      set({ lookNotice });
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
    setText: (text) => {
      set({ text });
    },
    toggleTextBlock: (index) => {
      const text = get().text;
      if (text?.status !== "done") return;
      const selected = text.selected.includes(index)
        ? text.selected.filter((i) => i !== index)
        : [...text.selected, index];
      set({ text: { ...text, selected } });
    },
    setCrop: (crop) => {
      set({ crop });
    },
    setAnimatedLook: (animatedLook) => {
      set({ animatedLook });
    },
    setAnimate: (animate) => {
      set({ animate });
    },
    setStudio: (studio) => {
      set({ studio, studioStart: null });
    },
    openShaderEditor: (studioStart) => {
      set({ studio: true, studioStart });
    },
    setCodeAllowed: (codeAllowed) => {
      set({ codeAllowed, codeVersion: get().codeVersion + 1 });
    },
    bumpCode: () => {
      set({ codeVersion: get().codeVersion + 1 });
    },
  }));
}
