import type { Layout } from "@/presentation/compose";
import { socialById } from "@/presentation/aspect-presets";
import { useEditor, useUi } from "./context";
import type { View } from "./view";

/**
 * The zones a social app covers with its own buttons (Presentation mode, "Show safe area"): shaded
 * stripes with a label over the composition. It is an overlay on the screen only, never part of an export.
 */
export function SafeAreaOverlay({ view, layout }: { view: View; layout: Layout }) {
  const on = useUi((s) => s.safeArea);
  const preset = useEditor((s) => socialById(s.project.presentation.aspect.preset));
  const area = preset?.safeArea;
  if (!on || !area) return null;
  const w = layout.canvas.width * view.zoom;
  const h = layout.canvas.height * view.zoom;
  const stripe = (key: string, style: React.CSSProperties, label?: string) => (
    <div
      key={key}
      className="pointer-events-none absolute flex items-center justify-center overflow-hidden bg-[repeating-linear-gradient(135deg,rgb(0_0_0/0.28)_0_6px,rgb(0_0_0/0.18)_6px_12px)]"
      style={style}
    >
      {label ? (
        <span className="rounded-sm bg-black/60 px-2 py-0.5 text-xs text-white">{label}</span>
      ) : null}
    </div>
  );
  return (
    <div data-testid="safe-area" className="pointer-events-none absolute inset-0">
      {area.top > 0
        ? stripe(
            "top",
            { left: view.x, top: view.y, width: w, height: h * area.top },
            area.topLabel,
          )
        : null}
      {area.bottom > 0
        ? stripe(
            "bottom",
            {
              left: view.x,
              top: view.y + h * (1 - area.bottom),
              width: w,
              height: h * area.bottom,
            },
            area.bottomLabel,
          )
        : null}
      {area.right > 0
        ? stripe("right", {
            left: view.x + w * (1 - area.right),
            top: view.y + h * area.top,
            width: w * area.right,
            height: h * (1 - area.top - area.bottom),
          })
        : null}
    </div>
  );
}
