import { createStore, type StoreApi } from "zustand/vanilla";
import type { ShaderScene } from "@/shader/types";

/** The speeds the preview can play at (preview only: the file never changes). */
export const PREVIEW_SPEEDS = [0.25, 0.5, 1, 2] as const;
export type PreviewSpeed = (typeof PREVIEW_SPEEDS)[number];

export type StudioDialog =
  "discard" | "export" | "freeze" | "save-look" | "too-large" | "new-shader" | "save-shader" | null;

/** The shader editor on top of the Studio: which layer it edits, or a new one that is not in the stack yet. */
export type ShaderEditorTarget =
  | { kind: "layer"; id: string }
  | { kind: "new"; role: "generator" | "effect"; name: string; code: string };

const MAX_HISTORY = 100;

export interface StudioState {
  /** What the Studio is working on. The document is untouched until Apply. */
  scene: ShaderScene;
  /** The scene the Studio was opened with (to tell whether anything changed). */
  base: ShaderScene;
  name: string;
  /** The layer the Inspector shows. */
  selected: string | null;
  /** Only this layer is drawn, while set. */
  solo: string | null;
  playing: boolean;
  /** Where the preview is, in seconds. */
  time: number;
  speed: PreviewSpeed;
  /** Plays the end of the loop into its start. */
  seam: boolean;
  /** The preview shows the screenshot on the background. */
  screenshot: boolean;
  past: ShaderScene[];
  future: ShaderScene[];
  /** The scene before the running gesture (a slider drag is one undo step). */
  gesture: ShaderScene | null;
  dialog: StudioDialog;
  /** The layer a dialog is about (Save to My shaders). */
  dialogLayer: string | null;
  editor: ShaderEditorTarget | null;
  /** A short message in the Studio (a layer that was switched off, a full stack). */
  notice: string | null;
  /** Layers with code that were switched off because they were too slow. */
  heavy: string[];
}

export interface StudioActions {
  /** Changes the scene in one undo step (or as part of the running gesture). */
  change(recipe: (scene: ShaderScene) => ShaderScene): void;
  /** Sets the scene without an undo step of its own (the first change of a gesture already made one). */
  begin(): void;
  end(): void;
  undo(): void;
  redo(): void;
  select(id: string | null): void;
  setSolo(id: string | null): void;
  setName(name: string): void;
  setTime(seconds: number): void;
  setPlaying(playing: boolean): void;
  setSpeed(speed: PreviewSpeed): void;
  setSeam(on: boolean): void;
  setScreenshot(on: boolean): void;
  setDialog(dialog: StudioDialog, layerId?: string | null): void;
  openEditor(target: ShaderEditorTarget | null): void;
  setNotice(notice: string | null): void;
  /** A layer with code was switched off for being too slow (`enabled: false` is set by the caller). */
  markHeavy(id: string): void;
  clearHeavy(id: string): void;
  /** A scene that is not an edit of this one (a template, a look): replaces everything, one undo step. */
  replaceScene(scene: ShaderScene): void;
}

export type StudioStore = StudioState & StudioActions;
export type StudioStoreApi = StoreApi<StudioStore>;

export const isDirty = (state: Pick<StudioState, "scene" | "base">): boolean =>
  JSON.stringify(state.scene) !== JSON.stringify(state.base);

export function createStudioStore(
  scene: ShaderScene,
  options: { name?: string; playing?: boolean } = {},
): StudioStoreApi {
  return createStore<StudioStore>()((set, get) => {
    const push = (next: ShaderScene) => {
      const { scene: current, gesture } = get();
      if (gesture !== null) {
        set({ scene: next });
        return;
      }
      set({ scene: next, past: [...get().past.slice(-(MAX_HISTORY - 1)), current], future: [] });
    };
    return {
      scene,
      base: scene,
      name: options.name ?? "New look",
      selected: scene.layers.at(-1)?.id ?? null,
      solo: null,
      playing: options.playing ?? true,
      time: scene.poster,
      speed: 1,
      seam: false,
      screenshot: true,
      past: [],
      future: [],
      gesture: null,
      dialog: null,
      dialogLayer: null,
      editor: null,
      notice: null,
      heavy: [],

      change: (recipe) => {
        const next = recipe(get().scene);
        if (next === get().scene) return;
        push(next);
      },
      begin: () => {
        if (get().gesture !== null) return;
        const current = get().scene;
        set({
          gesture: current,
          past: [...get().past.slice(-(MAX_HISTORY - 1)), current],
          future: [],
        });
      },
      end: () => {
        const { gesture, scene: current, past } = get();
        if (gesture === null) return;
        // A gesture that changed nothing leaves no step.
        set({
          gesture: null,
          past: JSON.stringify(gesture) === JSON.stringify(current) ? past.slice(0, -1) : past,
        });
      },
      undo: () => {
        const { past, scene: current, future } = get();
        const previous = past.at(-1);
        if (!previous) return;
        set({
          scene: previous,
          past: past.slice(0, -1),
          future: [current, ...future],
          selected: keep(get().selected, previous),
          solo: keep(get().solo, previous),
        });
      },
      redo: () => {
        const { past, scene: current, future } = get();
        const next = future[0];
        if (!next) return;
        set({
          scene: next,
          past: [...past, current],
          future: future.slice(1),
          selected: keep(get().selected, next),
          solo: keep(get().solo, next),
        });
      },
      select: (selected) => {
        set({ selected });
      },
      setSolo: (solo) => {
        set({ solo });
      },
      setName: (name) => {
        set({ name });
      },
      setTime: (time) => {
        set({ time });
      },
      setPlaying: (playing) => {
        set({ playing });
      },
      setSpeed: (speed) => {
        set({ speed });
      },
      setSeam: (seam) => {
        set({ seam });
      },
      setScreenshot: (screenshot) => {
        set({ screenshot });
      },
      setDialog: (dialog, layerId = null) => {
        set({ dialog, dialogLayer: layerId });
      },
      openEditor: (editor) => {
        set({ editor });
      },
      setNotice: (notice) => {
        set({ notice });
      },
      markHeavy: (id) => {
        if (!get().heavy.includes(id)) set({ heavy: [...get().heavy, id] });
      },
      clearHeavy: (id) => {
        set({ heavy: get().heavy.filter((h) => h !== id) });
      },
      replaceScene: (next) => {
        push(next);
        set({ selected: next.layers.at(-1)?.id ?? null, solo: null, time: next.poster });
      },
    };
  });
}

/** The id if the scene still has that layer, otherwise nothing. */
function keep(id: string | null, scene: ShaderScene): string | null {
  return id !== null && scene.layers.some((l) => l.id === id) ? id : null;
}
