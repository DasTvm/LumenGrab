import { createDocument, serializeDocument } from "@/document/write";
import { canvasCodec } from "@/document/render/canvas-codec";
import { renderPreview } from "@/document/render/flatten";
import { platform } from "@/platform";

/** Where "Save as…" put the file. `token` lets "Show" reveal exactly that file. */
export interface SavedAs {
  folder: string;
  fileName: string;
  token: string;
}

/**
 * "Save as…" of a Quick Access card: asks where and in which format (PNG or `.lumengrab`), then
 * writes the file through the place the dialog granted. `null` if the user cancelled.
 *
 * A `.lumengrab` is built here, from the screenshot exactly as saved (the original is never
 * re-encoded or changed), with a preview rendered from it.
 */
export async function saveScreenshotAs(card: {
  id: string;
  fileName: string;
}): Promise<SavedAs | null> {
  const target = await platform.pickSaveTarget({
    suggestedName: card.fileName,
    formats: ["png", "lumengrab"],
  });
  if (!target) return null;

  const png = await platform.quickAccessFileBytes(card.id);
  let bytes = png;
  if (target.format === "lumengrab") {
    const app = await platform.getAppInfo();
    const doc = await createDocument(png, {
      // The card sits on the monitor the capture came from, so its pixel ratio is the capture's scale.
      scale: Math.max(1, Math.round(window.devicePixelRatio * 2) / 2),
      createdBy: `${app.name} ${app.version}`,
    });
    bytes = serializeDocument(doc, await renderPreview(doc, canvasCodec));
  }
  await platform.writeGrantedFile(target.token, bytes);
  return { folder: target.folder, fileName: target.fileName, token: target.token };
}
