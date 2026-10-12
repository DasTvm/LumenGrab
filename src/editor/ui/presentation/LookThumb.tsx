import { useEffect, useRef } from "react";
import { computeLayout } from "@/presentation/compose";
import { drawComposition, ensureFrameFonts } from "@/presentation/draw-presentation";
import { previewPresentation, type Look } from "@/presentation/looks";
import { skeletonCanvas } from "@/presentation/skeleton";

const PICTURE = { width: 640, height: 400 };
let picture: OffscreenCanvas | null = null;
const skeleton = () => (picture ??= skeletonCanvas(PICTURE.width, PICTURE.height));

interface Props {
  look: Look;
  /** Size on screen in CSS pixels. */
  width: number;
  height: number;
  /** A picture of the user's look with its own background image (decoded), if it has one. */
  backgroundImage?: CanvasImageSource | null;
}

/** A look on a small skeleton window, drawn by the same code as the real thing. */
export function LookThumb({ look, width, height, backgroundImage = null }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const presentation = previewPresentation(look, PICTURE.width);
    let alive = true;
    void ensureFrameFonts(presentation.frame).then(() => {
      if (!alive) return;
      const layout = computeLayout(PICTURE, presentation);
      const scale = Math.max(
        canvas.width / layout.canvas.width,
        canvas.height / layout.canvas.height,
      );
      // The look fills the tile (cover): a tall or wide aspect shows its middle.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.translate(
        (canvas.width - layout.canvas.width * scale) / 2,
        (canvas.height - layout.canvas.height * scale) / 2,
      );
      drawComposition(ctx, { content: skeleton(), presentation, backgroundImage }, layout, scale);
    });
    return () => {
      alive = false;
    };
  }, [look, width, height, backgroundImage]);
  return <canvas ref={ref} aria-hidden className="block rounded-md" style={{ width, height }} />;
}
