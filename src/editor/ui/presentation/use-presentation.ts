import type { Presentation } from "@/document/schema";
import { useEditor, useStores, useUi } from "../context";

export interface PresentationEdit {
  p: Presentation;
  /** Changes the presentation in one undo step (or as part of a slider drag). */
  set: (recipe: (p: Presentation) => void) => void;
  /** A slider drag is one undo step. */
  start: () => void;
  end: () => void;
}

/** The presentation of the document and how a control changes it. */
export function usePresentation(): PresentationEdit {
  const { editor } = useStores();
  const p = useEditor((s) => s.project.presentation);
  return {
    p,
    set: (recipe) => {
      editor.getState().change((project) => {
        recipe(project.presentation);
      });
    },
    start: () => {
      editor.getState().beginGesture();
    },
    end: () => {
      editor.getState().endGesture();
    },
  };
}

/** The width of the picture the presentation goes around (crop or whole): looks and presets scale to it. */
export function usePictureWidth(): number {
  const crop = useEditor((s) => s.project.crop);
  const imageWidth = useUi((s) => s.imageSize.width);
  return Math.round(crop?.width ?? imageWidth);
}

/** The size of the picture the presentation goes around. */
export function usePictureSize(): { width: number; height: number } {
  const crop = useEditor((s) => s.project.crop);
  const image = useUi((s) => s.imageSize);
  return {
    width: Math.round(crop?.width ?? image.width),
    height: Math.round(crop?.height ?? image.height),
  };
}
