import { useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { Switch } from "@/ui/components/switch";
import { cn } from "@/ui/lib/utils";
import { useReducedMotion } from "@/ui/lib/use-reduced-motion";
import { useStudio, useStudioStore } from "./context";
import { PREVIEW_SPEEDS } from "./studio-store";

/** One frame of the preview, in seconds (the arrows and the step buttons move by it). */
export const FRAME = 1 / 30;

/** The labels under the track: whole seconds, as few as fit. */
export function tickStep(loop: number): number {
  for (const step of [1, 2, 5, 10, 15, 30]) if (loop / step <= 6) return step;
  return 30;
}

const fmt = (n: number) => n.toFixed(1);

/** Play, step, the playhead, the still-frame marker, preview speed and the seam check (design: Studio / Timeline). */
export function Timeline() {
  const store = useStudioStore();
  const loop = useStudio((s) => s.scene.loop);
  const poster = useStudio((s) => s.scene.poster);
  const time = useStudio((s) => s.time);
  const playing = useStudio((s) => s.playing);
  const speed = useStudio((s) => s.speed);
  const seam = useStudio((s) => s.seam);
  const reduced = useReducedMotion();
  const track = useRef<HTMLDivElement>(null);
  const [scrub, setScrub] = useState(false);
  const wasPlaying = useRef(false);

  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r) return 0;
    return Math.min(loop, Math.max(0, ((clientX - r.left) / r.width) * loop));
  };
  const goto = (seconds: number) => {
    store.getState().setTime(Math.min(loop, Math.max(0, Math.round(seconds * 10) / 10)));
  };
  const step = (by: number) => {
    const s = store.getState();
    s.setPlaying(false);
    const next = (((s.time + by) % loop) + loop) % loop;
    s.setTime(next);
  };

  const pct = (t: number) => `${String((Math.min(loop, t) / loop) * 100)}%`;
  const ticks: number[] = [];
  for (let t = 0; t < loop - 1e-6; t += tickStep(loop)) ticks.push(t);

  return (
    <div
      className="flex flex-col gap-3 border-t border-border px-5 py-3"
      aria-label="Timeline"
      role="group"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Back one frame"
          className="flex size-8 items-center justify-center rounded-md text-foreground hover:bg-muted"
          onClick={() => {
            step(-FRAME);
          }}
        >
          <SkipBack aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          aria-pressed={playing}
          className="flex size-9 items-center justify-center rounded-full bg-brand text-brand-foreground hover:opacity-90"
          onClick={() => {
            store.getState().setPlaying(!playing);
          }}
        >
          {playing ? (
            <Pause aria-hidden className="size-4 fill-current" />
          ) : (
            <Play aria-hidden className="size-4 fill-current" />
          )}
        </button>
        <button
          type="button"
          aria-label="Forward one frame"
          className="flex size-8 items-center justify-center rounded-md text-foreground hover:bg-muted"
          onClick={() => {
            step(FRAME);
          }}
        >
          <SkipForward aria-hidden className="size-4" />
        </button>
        <span data-testid="studio-time" className="w-24 text-[13px] font-medium tabular-nums">
          {`${fmt(time)} / ${fmt(loop)} s`}
        </span>
        {seam ? (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            Seam check: the end flows into the start
          </span>
        ) : reduced && !playing && time === 0 ? (
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
            Reduce Motion is on, so the preview starts paused. Press play to run it.
          </span>
        ) : null}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">Preview speed</span>
        <div
          role="radiogroup"
          aria-label="Preview speed"
          className="flex gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {PREVIEW_SPEEDS.map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={speed === v}
              className={cn(
                "h-7 rounded-md px-2.5 text-xs",
                speed === v
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                store.getState().setSpeed(v);
              }}
            >
              {`${String(v)}×`}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[13px] font-medium">
          Show seam
          <Switch
            aria-label="Show seam"
            checked={seam}
            onCheckedChange={(on) => {
              store.getState().setSeam(on);
              if (on) store.getState().setPlaying(true);
            }}
          />
        </label>
      </div>
      <div className="px-1 pb-1">
        <div
          ref={track}
          role="slider"
          tabIndex={0}
          aria-label="Time"
          aria-valuemin={0}
          aria-valuemax={loop}
          aria-valuenow={Math.round(time * 10) / 10}
          aria-valuetext={`${fmt(time)} of ${fmt(loop)} seconds`}
          className="relative h-6 cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            wasPlaying.current = store.getState().playing;
            store.getState().setPlaying(false);
            setScrub(true);
            goto(at(e.clientX));
          }}
          onPointerMove={(e) => {
            if (scrub) goto(at(e.clientX));
          }}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            setScrub(false);
            if (wasPlaying.current) store.getState().setPlaying(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              step((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 1 : FRAME));
            } else if (e.key === "Home") {
              e.preventDefault();
              goto(0);
            } else if (e.key === "End") {
              e.preventDefault();
              goto(loop - 0.1);
            }
          }}
        >
          <div className="absolute top-2.5 right-0 left-0 h-1 rounded-full bg-border" />
          <div
            className="absolute top-2.5 left-0 h-1 rounded-full bg-brand"
            style={{ width: pct(time) }}
          />
          <div
            className="absolute top-0 right-0 h-6 w-0.5 rounded-full bg-foreground"
            aria-hidden
          />
          <button
            type="button"
            aria-label="Still frame marker"
            title={`Still frame ${fmt(poster)} s`}
            className="absolute top-[7px] size-2.5 -translate-x-1/2 rotate-45 bg-foreground"
            style={{ left: pct(poster) }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              store.getState().begin();
            }}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const next = Math.round(at(e.clientX) * 10) / 10;
              store.getState().change((s) => ({ ...s, poster: Math.min(next, loop - 0.1) }));
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              store.getState().end();
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
          />
          <div
            aria-hidden
            className="absolute top-1 size-4 -translate-x-1/2 rounded-full border-2 border-foreground bg-background"
            style={{ left: pct(time) }}
          >
            {scrub ? (
              <span className="absolute -top-7 left-1/2 -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-[11px] text-background">
                {`${fmt(time)} s`}
              </span>
            ) : null}
          </div>
        </div>
        <div className="relative mt-1 h-4 text-[11px] text-muted-foreground">
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute -translate-x-1/2 first:translate-x-0"
              style={{ left: pct(t) }}
            >
              {`${String(t)} s`}
            </span>
          ))}
          <span className="absolute right-0">{`${String(loop)} s · Loop end`}</span>
        </div>
      </div>
    </div>
  );
}
