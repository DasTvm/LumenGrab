import { useEffect, useState } from "react";
import type { Presentation } from "@/document/schema";

/**
 * The decoded background picture of a presentation (an `image` background), or `null` while it loads,
 * when the background is not an image, or when the file is missing or cannot be decoded (the
 * drawing then shows a plain background, docs/FORMAT.md section 4b).
 */
export function useBackgroundBitmap(
  assets: Readonly<Record<string, Uint8Array>>,
  background: Presentation["background"],
): ImageBitmap | null {
  const bytes = background.type === "image" ? assets[background.asset] : undefined;
  const [made, setMade] = useState<{ bytes: Uint8Array; bitmap: ImageBitmap } | null>(null);
  useEffect(() => {
    if (!bytes) return;
    let alive = true;
    let bitmap: ImageBitmap | null = null;
    createImageBitmap(new Blob([new Uint8Array(bytes)]))
      .then((b) => {
        if (alive) {
          bitmap = b;
          setMade({ bytes, bitmap: b });
        } else b.close();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      // The canvas may still draw it for one frame; closing is deferred past it.
      const old = bitmap;
      if (old)
        setTimeout(() => {
          old.close();
        }, 100);
    };
  }, [bytes]);
  return made && made.bytes === bytes ? made.bitmap : null;
}
