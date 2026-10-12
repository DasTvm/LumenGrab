import { FACTORY_LOOK_ID } from "@/presentation/auto-look";
import { applyLook, builtinById, type Look } from "@/presentation/looks";
import type { EditorStoreApi } from "../model/store";
import { cancelCrop } from "./crop-mode";
import { applyLookToDocument } from "./presentation/apply-look";
import { looksStore } from "./presentation/looks-instance";
import type { DocumentSession } from "./session";
import { finishEditing } from "./text-edit";
import type { EditorMode, UiStoreApi } from "./ui-store";

export { FACTORY_LOOK_ID };

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
  session?: DocumentSession,
): void {
  if (ui.getState().mode === mode) return;
  if (mode === "presentation") {
    finishEditing(editor, ui);
    if (ui.getState().crop) cancelCrop(editor, ui);
    editor.getState().select([]);
    applyDefaultLook(editor, ui, session);
  }
  ui.getState().setMode(mode);
}

/**
 * Puts the default look on a picture whose presentation is off (one undo step): the user's default
 * look, or the factory look. A look with a picture is read from disk first; if it is gone the factory
 * look is used and the notice says so.
 */
export function applyDefaultLook(
  editor: EditorStoreApi,
  ui: UiStoreApi,
  session?: DocumentSession,
): void {
  const { presentation, crop } = editor.getState().project;
  if (presentation.enabled) return;
  const width = Math.round(crop?.width ?? ui.getState().imageSize.width);
  const factory = builtinById(FACTORY_LOOK_ID);
  const wanted: Look | null = looksStore.getState().defaultLook ?? factory;
  if (wanted && session) {
    void applyLookToDocument(wanted, { editor, ui, session, width }).then((ok) => {
      if (!ok && factory) {
        editor.getState().change((p) => {
          p.presentation = applyLook(p.presentation, factory, width);
        });
      }
    });
  } else if (wanted) {
    editor.getState().change((p) => {
      p.presentation = applyLook(p.presentation, wanted, width);
    });
  }
}
