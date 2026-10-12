import { applyLook, builtinById, type Look } from "@/presentation/looks";
import type { EditorStoreApi } from "../model/store";
import { cancelCrop } from "./crop-mode";
import { finishEditing } from "./text-edit";
import type { EditorMode, UiStoreApi } from "./ui-store";

/** The look a picture gets the first time its Presentation tab is opened, when the user set no default. */
export const FACTORY_LOOK_ID = "midnight";

/**
 * Switches between Annotate and Presentation. Leaving Annotate ends text editing and the crop frame and
 * clears the selection (Presentation mode shows the finished picture, nothing is selected in it). A picture
 * whose presentation is off gets the default look when its Presentation tab is first opened, as one
 * undo step, so the tab is never an empty panel.
 */
export function switchMode(
  editor: EditorStoreApi,
  ui: UiStoreApi,
  mode: EditorMode,
  defaultLook: Look | null = builtinById(FACTORY_LOOK_ID),
): void {
  if (ui.getState().mode === mode) return;
  if (mode === "presentation") {
    finishEditing(editor, ui);
    if (ui.getState().crop) cancelCrop(editor, ui);
    editor.getState().select([]);
    const { presentation, crop } = editor.getState().project;
    if (!presentation.enabled && defaultLook) {
      const width = crop?.width ?? ui.getState().imageSize.width;
      editor.getState().change((p) => {
        p.presentation = applyLook(p.presentation, defaultLook, width);
      });
    }
  }
  ui.getState().setMode(mode);
}
