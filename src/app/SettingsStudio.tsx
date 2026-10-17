import { useEffect, useState } from "react";
import { canvasCodec } from "@/document/render/canvas-codec";
import type { RgbaImage } from "@/document/render/pixels";
import { createDocument, defaultPresentation } from "@/document/write";
import type { DocumentFile } from "@/document/types";
import { BaseImage } from "@/editor/ui/base-image";
import { EditorProvider } from "@/editor/ui/context";
import { looksStore } from "@/editor/ui/presentation/looks-instance";
import { DocumentSession } from "@/editor/ui/session";
import { StudioHost } from "@/editor/ui/studio/Studio";
import { createUiStore, type UiStoreApi } from "@/editor/ui/ui-store";
import { createEditorStore, type EditorStoreApi } from "@/editor/model/store";
import { applyLook, type Look } from "@/presentation/looks";
import { skeletonCanvas } from "@/presentation/skeleton";

interface Env {
  editor: EditorStoreApi;
  ui: UiStoreApi;
  session: DocumentSession;
  base: BaseImage;
  doc: DocumentFile;
  before: string;
}

/**
 * "Edit look" in Settings: the Background Studio on a skeleton screenshot (there is no document in this window).
 * Apply keeps the changed background in the default look; Cancel leaves it as it was.
 */
export function SettingsStudio({ look, onClose }: { look: Look; onClose: () => void }) {
  const [env, setEnv] = useState<Env | null>(null);

  useEffect(() => {
    const life = { alive: true };
    void (async () => {
      const canvas = skeletonCanvas(640, 400);
      const png = new Uint8Array(
        await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
      );
      const doc = await createDocument(png, { scale: 1 });
      const project0 = doc.project;
      if (!project0) return;
      const source: RgbaImage = await canvasCodec.decode(png);
      const project = {
        ...project0,
        presentation: applyLook(defaultPresentation(), look, source.width),
      };
      const editor = createEditorStore(project);
      const ui = createUiStore({ width: source.width, height: source.height });
      const session = new DocumentSession({
        label: "settings-studio",
        doc,
        source,
        info: { fileName: look.name, folder: "", kind: "capture" },
        app: { name: "LumenGrab", version: "" },
        editor,
        ui,
        onMeta: () => undefined,
        onDialog: () => undefined,
      });
      // The look is the user's own: its code may run.
      const code = look.parts.background?.type === "shader" ? look.parts.background.layers : [];
      for (const layer of code) if (layer.code) session.noteOwnCode(layer.code);
      ui.getState().setStudio(true);
      if (life.alive)
        setEnv({
          editor,
          ui,
          session,
          base: new BaseImage(source),
          doc,
          before: JSON.stringify(project.presentation.background),
        });
    })();
    return () => {
      life.alive = false;
    };
    // The look is read once, when the Studio opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the Studio closes with a changed background, that is the new default look.
  useEffect(() => {
    if (!env) return;
    return env.ui.subscribe((state) => {
      if (state.studio) return;
      const background = env.editor.getState().project.presentation.background;
      if (JSON.stringify(background) !== env.before) {
        void (async () => {
          if (background.type === "image") {
            const bytes = env.session.assets[background.asset];
            if (bytes) await looksStore.getState().addAsset(background.asset, bytes);
          }
          await looksStore.getState().setDefault({ ...look, parts: { ...look.parts, background } });
          onClose();
        })();
      } else onClose();
    });
  }, [env, look, onClose]);

  if (!env) return null;
  return (
    <EditorProvider editor={env.editor} ui={env.ui} session={env.session}>
      <StudioHost base={env.base} />
    </EditorProvider>
  );
}
