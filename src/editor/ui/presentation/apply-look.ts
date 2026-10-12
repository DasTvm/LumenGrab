import { applyLook, type Look } from "@/presentation/looks";
import { looksStore } from "./looks-instance";
import type { EditorStoreApi } from "../../model/store";
import type { DocumentSession } from "../session";
import type { UiStoreApi } from "../ui-store";

/** What `applyLookToDocument` needs from the editor. */
export interface ApplyEnv {
  editor: EditorStoreApi;
  ui: UiStoreApi;
  session: DocumentSession;
  /** The width of the picture the look goes around (lengths scale to it). */
  width: number;
}

/**
 * Puts a look on the document as one undo step. A look with a background picture needs that picture
 * from the looks store; if it is gone, nothing changes and the editor shows the notice with its two
 * ways out (choose another picture, or drop the picture from the look).
 */
export async function applyLookToDocument(look: Look, env: ApplyEnv): Promise<boolean> {
  const bg = look.parts.background;
  let applied = look;
  if (bg?.type === "image") {
    const bytes = bg.asset ? await looksStore.getState().readAsset(bg.asset) : null;
    const named = bytes ? await env.session.addAsset(bytes) : null;
    if (!named || "error" in named) {
      env.ui.getState().setLookNotice({
        lookId: look.id,
        lookName: look.name,
        message: `“${look.name}” uses a picture that can't be found.`,
      });
      return false;
    }
    applied = { ...look, parts: { ...look.parts, background: { ...bg, asset: named.name } } };
  }
  env.ui.getState().setLookNotice(null);
  env.editor.getState().change((project) => {
    project.presentation = applyLook(project.presentation, applied, env.width);
  });
  return true;
}
