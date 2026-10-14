import { useState } from "react";
import { Scissors } from "lucide-react";
import type { Rect } from "@/document/schema";
import { Button } from "@/ui/components/button";
import { cropForKeep, measureEdges, type Measured, type Space } from "@/presentation/balance";
import { useEditor, useStores } from "../context";
import { Slider } from "../controls";
import { SliderRow } from "./fields";

const sameRect = (a: Rect | null, b: Rect) =>
  a !== null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

interface Trim {
  measured: Measured;
  keep: Space;
  /** The crop this trim made: when the document's crop is another one (undo, a new crop), the slider is gone. */
  last: Rect;
}

/**
 * "Trim empty edges": crops the empty space around the content of the screenshot itself. It leaves the
 * smallest margin the picture really has on every side (a side that touches the edge is no model), so
 * the content is not cut at its pixel edge; a slider fine-tunes how much space stays.
 */
export function TrimEdges() {
  const { editor, session } = useStores();
  const crop = useEditor((s) => s.project.crop);
  const [trim, setTrim] = useState<Trim | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const source = session.sourceImage;
  const whole = { x: 0, y: 0, width: source.width, height: source.height };
  /** The whole picture is no crop. */
  const asCrop = (rect: Rect): Rect | null => (sameRect(rect, whole) ? null : rect);
  const active = trim && sameRect(crop, trim.last) ? trim : null;

  const apply = (measured: Measured, keep: Space): Rect => {
    const rect = cropForKeep(measured, keep);
    editor.getState().change((project) => {
      project.crop = asCrop(rect);
    });
    return rect;
  };

  const run = () => {
    const measured = measureEdges(source, editor.getState().project.crop);
    const rect = measured ? cropForKeep(measured, measured.keep) : null;
    if (!measured || !rect || sameRect(rect, measured.area)) {
      setMessage("There is no extra empty space to trim.");
      setTrim(null);
      return;
    }
    const was = measured.area;
    const sides = [
      ["the left", rect.x - was.x],
      ["the top", rect.y - was.y],
      ["the right", was.x + was.width - (rect.x + rect.width)],
      ["the bottom", was.y + was.height - (rect.y + rect.height)],
    ] as const;
    const text = sides
      .filter(([, px]) => px > 0)
      .map(([name, px]) => `${String(Math.round(px))} px from ${name}`)
      .join(", ");
    apply(measured, measured.keep);
    setTrim({ measured, keep: measured.keep, last: rect });
    setMessage(`Trimmed ${text}. Undo brings it back.`);
  };

  return (
    <>
      <Button variant="outline" className="h-9 gap-2" onClick={run}>
        <Scissors aria-hidden className="size-4" />
        Trim empty edges
      </Button>
      {active
        ? (
            [
              { axis: "x", label: "Space left and right" },
              { axis: "y", label: "Space top and bottom" },
            ] as const
          ).map(({ axis, label }) => (
            <SliderRow key={axis} label={label} value={`${String(active.keep[axis])} px`}>
              <Slider
                label={label}
                value={active.keep[axis]}
                min={0}
                max={Math.max(1, active.measured.maxKeep[axis])}
                onStart={() => {
                  editor.getState().beginGesture();
                }}
                onEnd={() => {
                  editor.getState().endGesture();
                }}
                onChange={(value) => {
                  const keep = { ...active.keep, [axis]: value };
                  const rect = apply(active.measured, keep);
                  setTrim({ ...active, keep, last: rect });
                }}
              />
            </SliderRow>
          ))
        : null}
      <p className="text-[13px] text-muted-foreground" role="status">
        {message ??
          "Too much empty space on one side of the screenshot? This crops it to the smallest margin the picture has, so the content sits evenly. The original stays untouched."}
      </p>
      {active ? (
        <p className="text-[13px] text-muted-foreground">
          Cut too much or too little? Move the sliders, each side pair on its own: 0 sits right at
          the content.
        </p>
      ) : null}
    </>
  );
}
