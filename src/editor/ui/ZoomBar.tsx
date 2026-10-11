import { Maximize2, Minus, Plus, Ruler } from "lucide-react";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import { useEditor, useStores, useUi } from "./context";
import { centerView, fitView, stepZoom, zoomAt, zoomLabel, type Size } from "./view";

interface Props {
  area: Size;
}

/**
 * The zoom bar at the bottom of the canvas (design: Zoom Bar): zoom out and in, the percentage, Fit,
 * 100 %, and the size of the picture (or of the crop).
 */
export function ZoomBar({ area }: Props) {
  const { ui, editor } = useStores();
  const view = useUi((s) => s.view);
  const fit = useUi((s) => s.fit);
  const imageSize = useUi((s) => s.imageSize);
  const saved = useEditor((s) => s.project.crop);
  const draft = useUi((s) => s.crop);
  const crop = draft?.rect ?? saved;

  const content = () =>
    (ui.getState().crop ? null : editor.getState().project.crop) ?? { x: 0, y: 0, ...imageSize };
  const zoomTo = (zoom: number) => {
    const v = ui.getState().view;
    if (v) ui.getState().setView(zoomAt(v, { x: area.width / 2, y: area.height / 2 }, zoom));
  };
  const text = `${String(Math.round(crop?.width ?? imageSize.width))} × ${String(Math.round(crop?.height ?? imageSize.height))} px`;
  const SizeIcon = crop ? Maximize2 : Ruler;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
      <div
        role="toolbar"
        aria-label="Zoom"
        onPointerDown={(e) => {
          e.stopPropagation();
        }}
        className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-[0_2px_8px_rgb(0_0_0/0.1)]"
      >
        <Button
          variant="ghost"
          aria-label="Zoom out"
          className="size-7 p-0"
          onClick={() => {
            if (view) zoomTo(stepZoom(view.zoom, -1));
          }}
        >
          <Minus aria-hidden className="size-4" />
        </Button>
        <span
          data-testid="zoom-label"
          className="min-w-12 text-center text-[13px] text-muted-foreground tabular-nums"
        >
          {view ? zoomLabel(view.zoom) : ""}
        </span>
        <Button
          variant="ghost"
          aria-label="Zoom in"
          className="size-7 p-0"
          onClick={() => {
            if (view) zoomTo(stepZoom(view.zoom, 1));
          }}
        >
          <Plus aria-hidden className="size-4" />
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <Button
          variant="ghost"
          className={cn("h-7 px-2 text-sm", fit && "bg-muted")}
          aria-pressed={fit}
          onClick={() => {
            ui.getState().setView(fitView(area, content()), true);
          }}
        >
          Fit
        </Button>
        <Button
          variant="ghost"
          className="h-7 px-2 text-sm"
          onClick={() => {
            ui.getState().setView(centerView(area, content(), 1));
          }}
        >
          100%
        </Button>
        <span className="mx-1 h-4 w-px bg-border" />
        <span
          data-testid="size-readout"
          className="flex items-center gap-1.5 px-2 text-[13px] text-muted-foreground"
        >
          <SizeIcon aria-hidden className="size-3.5" />
          {text}
        </span>
      </div>
    </div>
  );
}
