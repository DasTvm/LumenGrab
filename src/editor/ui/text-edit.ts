import { randomId, type EditorStoreApi } from "../model/store";
import { newText } from "../model/style";
import { findLayer } from "../model/tree";
import type { Layer, Point } from "@/document/schema";
import type { UiStoreApi } from "./ui-store";

/**
 * Editing a text layer in place (design: Text editing in place). The whole session is one gesture:
 * typing, changing the width and changing the style are one undo step, and a new text box that stays
 * empty leaves no trace. Pure store logic, tested in Node; `TextEditor.tsx` is the text field.
 */
/** The words of a text layer. */
export const textOf = (layer: Layer): string =>
  typeof layer["text"] === "string" ? layer["text"] : "";

export function startNewText(editor: EditorStoreApi, ui: UiStoreApi, at: Point): string {
  finishEditing(editor, ui);
  const id = randomId();
  editor.getState().beginGesture();
  editor
    .getState()
    .addLayer(
      newText(
        id,
        { x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100 },
        ui.getState().options.text,
      ),
    );
  ui.getState().setEditing({ id, isNew: true });
  return id;
}

/** Edits an existing text layer. Locked layers are not edited. */
export function startEditText(editor: EditorStoreApi, ui: UiStoreApi, id: string): boolean {
  const layer = findLayer(editor.getState().project.layers, id);
  if (layer?.type !== "text" || layer.locked) return false;
  finishEditing(editor, ui);
  editor.getState().beginGesture();
  editor.getState().select([id]);
  ui.getState().setEditing({ id, isNew: false });
  return true;
}

export function setText(editor: EditorStoreApi, id: string, text: string): void {
  editor.getState().change((p) => {
    const layer = findLayer(p.layers, id);
    if (layer) layer["text"] = text;
  });
}

/** Sets the width of the text box (the handle on its right edge); `null` goes back to growing with the text. */
export function setTextWidth(editor: EditorStoreApi, id: string, width: number | null): void {
  editor.getState().change((p) => {
    const layer = findLayer(p.layers, id);
    if (layer) layer["width"] = width === null ? null : Math.max(20, Math.round(width * 100) / 100);
  });
}

/**
 * Ends the session. Text that is empty (a box nobody typed in, or all text deleted) is removed again:
 * a new one without a trace, an old one as the deletion it is.
 */
export function finishEditing(editor: EditorStoreApi, ui: UiStoreApi): void {
  const editing = ui.getState().editing;
  if (!editing) return;
  ui.getState().setEditing(null);
  const state = editor.getState();
  const layer = findLayer(state.project.layers, editing.id);
  const empty = !layer || textOf(layer).trim() === "";
  if (empty && editing.isNew) {
    state.cancelGesture();
    return;
  }
  if (empty && layer) {
    // An existing text emptied out: delete it in the same step.
    state.change((p) => {
      const at = p.layers.findIndex((l) => l.id === editing.id);
      if (at >= 0) p.layers.splice(at, 1);
    });
    state.endGesture();
    state.select([]);
    return;
  }
  state.endGesture();
}
