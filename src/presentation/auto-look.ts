import type { RgbaImage } from "@/document/render/pixels";
import { defaultPresentation } from "@/document/write";
import { editorCodec } from "@/editor/draw/codec";
import { applyLook, builtinById, type Look } from "./looks";
import { assetsOfLooks } from "./looks-store";

/** The look a capture gets when the user has not chosen one: the same factory look as the editor's first Presentation tab. */
export const FACTORY_LOOK_ID = "midnight";

/**
 * The automatic look (docs/adr/0007): puts the default look on a capture (raw pixels, no PNG on the way) and returns the finished picture,
 * with the same drawing code as the editor and the export. The capture is the whole picture (no crop,
 * no annotations); lengths of the look scale to its width like in the editor. Throws if the look needs a
 * picture that is gone, so the capture is delivered as it is rather than with a wrong background.
 */
export async function renderDefaultLook(
  picture: RgbaImage,
  look: Look | null,
  readAsset: (name: string) => Promise<Uint8Array | null>,
): Promise<RgbaImage> {
  const chosen = look ?? builtinById(FACTORY_LOOK_ID);
  if (!chosen) throw new Error("There is no look to apply.");
  const assets: Record<string, Uint8Array> = {};
  for (const name of assetsOfLooks({ version: 1, looks: [chosen], defaultLook: null })) {
    const bytes = await readAsset(name);
    if (!bytes) throw new Error("A picture of the look is missing.");
    assets[name] = bytes;
  }
  const presentation = applyLook(defaultPresentation(), chosen, picture.width);
  if (!editorCodec.present) throw new Error("This renderer cannot draw a presentation.");
  return editorCodec.present(picture, presentation, assets);
}
