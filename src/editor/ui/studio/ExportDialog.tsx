import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, CircleX, Download, Folder, Info, Check, X } from "lucide-react";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import { computeLayout } from "@/presentation/compose";
import { platform, type SaveTarget } from "@/platform";
import {
  FRAME_RATES,
  GIF_COLOURS,
  REPEATS,
  estimateGifBytes,
  estimatePictureBytes,
  estimateVideoBytes,
  fileStem,
  fitSize,
  formatBytes,
  planMotion,
  sampleSize,
  scaleMeasuredBytes,
  timeLeft,
  type Content,
  type ExportKind,
  type PictureFormat,
  type Quality,
  type SizePreset,
  type VideoFormat,
} from "@/shader/export-model";
import {
  ExportCancelled,
  canMakeVideo,
  makeFrameSource,
  makeGif,
  makePicture,
  makeVideo,
  measureBytes,
  type Progress,
} from "@/shader/export-run";
import { posterSeconds } from "@/shader/scene";
import type { BaseImage } from "../base-image";
import { useEditor, useStores } from "../context";
import { Modal } from "@/ui/components/modal";
import { renderPicture } from "../picture";
import { StudioProvider, useStudio, useStudioStore } from "./context";
import { createStudioStore } from "./studio-store";

type Run =
  | { phase: "form" }
  | { phase: "progress"; progress: Progress }
  | { phase: "done"; name: string; detail: string; token: string }
  | { phase: "failed"; message: string };

const SIZES: { id: SizePreset; label: string }[] = [
  { id: "720p", label: "720p" },
  { id: "1080p", label: "1080p" },
  { id: "4k", label: "4K" },
  { id: "canvas", label: "Canvas size" },
];

const QUALITY_STEPS: { id: Quality; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5 rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={String(o.id)}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={cn(
            "h-8 flex-1 rounded-md text-[13px]",
            value === o.id
              ? "bg-background font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => {
            onChange(o.id);
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="font-medium">{label}</span>
        {value ? <span className="text-xs text-muted-foreground tabular-nums">{value}</span> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Export from the Studio (design: Studio / Export): the animated background as a video, a GIF or a picture, with the
 * screenshot on it or without. Progress, cancel and the ways it can fail are part of the dialog.
 */
export function StudioExportDialog({ base, onClose }: { base: BaseImage; onClose: () => void }) {
  const store = useStudioStore();
  const project = useEditor((s) => s.project);
  const scene = useStudio((s) => s.scene);
  const name = useStudio((s) => s.name);
  const [kind, setKind] = useState<ExportKind>("video");
  const [content, setContent] = useState<Content>("composition");
  const [size, setSize] = useState<SizePreset>("1080p");
  const [fps, setFps] = useState<number>(30);
  const [repeats, setRepeats] = useState<number>(1);
  const [quality, setQuality] = useState<Quality>("high");
  const [colours, setColours] = useState<number>(256);
  const [pictureFormat, setPictureFormat] = useState<PictureFormat>("png");
  const [videoFormat, setVideoFormat] = useState<VideoFormat>("mp4");
  const [run, setRun] = useState<Run>({ phase: "form" });
  const [checked, setChecked] = useState<{ key: string; ok: boolean } | null>(null);
  const abort = useRef<AbortController | null>(null);

  const picture = useMemo(
    () => project.crop ?? { x: 0, y: 0, width: base.width, height: base.height },
    [project.crop, base.width, base.height],
  );
  const presentation = useMemo(
    () => ({ ...project.presentation, enabled: true, background: scene }),
    [project.presentation, scene],
  );
  const canvas = useMemo(
    () => computeLayout(picture, presentation).canvas,
    [picture, presentation],
  );

  const motionKind = kind === "gif" ? "gif" : "video";
  const pixels = fitSize(canvas, kind === "gif" && size === "4k" ? "1080p" : size, {
    even: kind === "video",
  });
  const plan = planMotion(scene, pixels, fps, repeats, motionKind);
  const guess =
    kind === "video"
      ? estimateVideoBytes(pixels, plan, quality)
      : kind === "gif"
        ? estimateGifBytes(pixels, plan, colours)
        : estimatePictureBytes(pixels, pictureFormat);

  // The size of a video or a GIF depends on what is in it (a soft gradient is a fraction of busy noise), so a piece of
  // it is made for real a moment after the last change. Until then, and where that does not work, the rule of thumb stands.
  const measureKey = [
    kind,
    videoFormat,
    quality,
    colours,
    fps,
    plan.frames,
    pixels.width,
    pixels.height,
    content,
    scene.loop,
  ].join("|");
  const [measured, setMeasured] = useState<{ key: string; bytes: number | null } | null>(null);
  useEffect(() => {
    if (kind === "picture" || run.phase !== "form") return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void (async () => {
        try {
          // A small picture is measured and the result is carried to the real size: a 4K frame would hold the page up.
          const small = sampleSize(pixels, { even: kind === "video" });
          const source = makeFrameSource({
            scene,
            presentation,
            picture,
            content: renderPicture(base, project.layers, project.crop),
            mode: content,
            width: small.width,
            height: small.height,
          });
          const sampled = await measureBytes({
            kind,
            source,
            scene,
            format: videoFormat,
            quality,
            colours,
            fps,
            frames: plan.frames,
            signal: controller.signal,
          });
          const bytes = scaleMeasuredBytes(sampled, small, pixels, kind);
          if (!controller.signal.aborted) setMeasured({ key: measureKey, bytes });
        } catch {
          if (!controller.signal.aborted) setMeasured({ key: measureKey, bytes: null });
        }
      })();
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // The settings that change the file are in the key; the rest (the document) does not change while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measureKey, run.phase]);
  const known = measured?.key === measureKey ? measured.bytes : undefined;
  const bytes = known ?? guess;

  useEffect(() => {
    store.getState().setPlaying(false);
  }, [store]);
  // Whether this computer can make the video as asked (the answer belongs to the format and size it was asked for).
  const videoKey = `${videoFormat}-${String(pixels.width)}x${String(pixels.height)}`;
  useEffect(() => {
    if (kind !== "video") return;
    let alive = true;
    void canMakeVideo(videoFormat, pixels.width, pixels.height).then((ok) => {
      if (alive) setChecked({ key: videoKey, ok });
    });
    return () => {
      alive = false;
    };
  }, [kind, videoFormat, videoKey, pixels.width, pixels.height]);
  const canVideo = checked?.key === videoKey ? checked.ok : null;

  const ext = kind === "video" ? videoFormat : kind === "gif" ? "gif" : pictureFormat;
  const busy = run.phase === "progress";
  const blocked = kind === "video" && canVideo === false;

  const start = async () => {
    const target: SaveTarget | null = await platform.pickSaveTarget({
      suggestedName: `${fileStem(name)}.${ext}`,
      formats: [ext],
    });
    if (!target) return;
    const controller = new AbortController();
    abort.current = controller;
    setRun({
      phase: "progress",
      progress: { frame: 0, total: plan.frames, secondsLeft: Number.NaN },
    });
    try {
      const content_ = renderPicture(base, project.layers, project.crop);
      const source = makeFrameSource({
        scene,
        presentation,
        picture,
        content: content_,
        mode: content,
        width: pixels.width,
        height: pixels.height,
      });
      const onProgress = (progress: Progress) => {
        setRun({ phase: "progress", progress });
      };
      let data: Uint8Array;
      if (kind === "video") {
        data = await makeVideo({
          source,
          scene,
          format: videoFormat,
          quality,
          fps,
          frames: plan.frames,
          signal: controller.signal,
          onProgress,
        });
      } else if (kind === "gif") {
        data = await makeGif({
          source,
          scene,
          colours,
          fps,
          frames: plan.frames,
          signal: controller.signal,
          onProgress,
        });
      } else {
        data = await makePicture({ source, scene, format: pictureFormat });
      }
      await platform.writeGrantedFile(target.token, data);
      setRun({
        phase: "done",
        name: target.fileName,
        token: target.token,
        detail:
          kind === "picture"
            ? `${formatBytes(data.length)} · ${String(pixels.width)} × ${String(pixels.height)}`
            : `${formatBytes(data.length)} · ${String(Math.round(plan.seconds))} s · ${kind === "gif" ? `${String(pixels.width)} × ${String(pixels.height)}` : size === "canvas" ? "canvas size" : size === "4k" ? "4K" : size}`,
      });
    } catch (error) {
      if (error instanceof ExportCancelled) {
        setRun({ phase: "form" });
        return;
      }
      setRun({
        phase: "failed",
        message: error instanceof Error ? error.message : "The export did not work.",
      });
    } finally {
      abort.current = null;
    }
  };

  const close = () => {
    abort.current?.abort();
    onClose();
  };

  const title = "Export";
  const subtitle =
    kind === "picture"
      ? "Save a still picture of the background or the whole composition."
      : "Render your animated background as a short loop.";

  return (
    <Modal label={title} onClose={busy ? undefined : close} className="w-[560px]">
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-[13px] text-muted-foreground">{subtitle}</p>
        </div>
        <button
          type="button"
          aria-label="Close"
          disabled={busy}
          className="flex size-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40"
          onClick={close}
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <Seg
        label="What to make"
        value={kind}
        options={[
          { id: "video", label: "Video" },
          { id: "gif", label: "GIF" },
          { id: "picture", label: "Picture" },
        ]}
        onChange={(next) => {
          if (!busy) setKind(next);
        }}
      />

      {run.phase === "progress" ? (
        <div className="flex flex-col gap-3 rounded-lg bg-muted/60 p-4" role="status">
          <div className="flex items-baseline justify-between text-[13px] font-medium">
            <span>{`Frame ${String(run.progress.frame)} of ${String(run.progress.total)}`}</span>
            <span className="tabular-nums">{`${String(Math.round((run.progress.frame / Math.max(1, run.progress.total)) * 100))}%`}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-brand"
              style={{
                width: `${String((run.progress.frame / Math.max(1, run.progress.total)) * 100)}%`,
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {`${timeLeft(run.progress.secondsLeft)}. You can keep working in the Studio, but the preview may stutter.`}
          </p>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => {
                abort.current?.abort();
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : run.phase === "done" ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-lg bg-[#effaf3] p-4">
            <span className="flex size-9 items-center justify-center rounded-full bg-[#1a9b54] text-white">
              <Check aria-hidden className="size-4" />
            </span>
            <div className="flex min-w-0 flex-col">
              <span className="text-[13px] font-semibold">Export finished</span>
              <span className="truncate text-[13px]">{run.name}</span>
              <span className="text-xs text-muted-foreground">{run.detail}</span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                void platform.revealSavedFile(run.token);
              }}
            >
              <Folder aria-hidden /> Show in folder
            </Button>
            <Button data-autofocus onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <>
          {run.phase === "failed" ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-[#f5b5b0] bg-[#fdf0ef] p-3 text-[#8a1c13]"
            >
              <CircleX aria-hidden className="mt-0.5 size-5 shrink-0 text-[#d92d20]" />
              <div className="flex flex-col text-[13px]">
                <span className="font-semibold">The export did not work.</span>
                <span>{run.message}</span>
              </div>
            </div>
          ) : null}
          {blocked ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-[#f5b5b0] bg-[#fdf0ef] p-3 text-[#8a1c13]"
            >
              <CircleX aria-hidden className="mt-0.5 size-5 shrink-0 text-[#d92d20]" />
              <div className="flex min-w-0 flex-1 flex-col text-[13px]">
                <span className="font-semibold">{`This computer cannot create ${videoFormat === "mp4" ? "MP4" : "WebM"}.`}</span>
                <span>
                  Use GIF instead. It works everywhere, but the file is larger and has fewer
                  colours.
                </span>
              </div>
              <div className="flex shrink-0 flex-col gap-1.5">
                <Button
                  variant="outline"
                  className="h-8 gap-1.5 bg-white text-[13px] text-foreground"
                  onClick={() => {
                    setKind("gif");
                    setFps(24);
                    setSize("720p");
                  }}
                >
                  <ArrowRightLeft aria-hidden className="size-3.5" /> Switch to GIF
                </Button>
                {videoFormat === "mp4" ? (
                  <Button
                    variant="outline"
                    className="h-8 bg-white text-[13px] text-foreground"
                    onClick={() => {
                      setVideoFormat("webm");
                    }}
                  >
                    Try WebM
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          {plan.shortened && kind !== "picture" ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-[#f3d38a] bg-[#fff8e6] p-3 text-[#6b4a05]"
            >
              <Info aria-hidden className="mt-0.5 size-5 shrink-0 text-[#b54708]" />
              <div className="flex flex-col text-[13px]">
                <span className="font-semibold">Length is limited at this size and frame rate</span>
                <span>
                  This export is longer than allowed at{" "}
                  {size === "4k" ? "4K" : pixels.width > 1920 ? "this size" : "this size"} and{" "}
                  {String(fps)} fps, so it is shortened. Lower the size, the frame rate or the
                  repeats to keep all of it.
                </span>
              </div>
            </div>
          ) : null}

          <Field label="Content">
            <Seg
              label="Content"
              value={content}
              options={[
                { id: "composition", label: "Whole composition" },
                { id: "background", label: "Background only" },
              ]}
              onChange={setContent}
            />
          </Field>
          <Field
            label="Size"
            value={`${String(pixels.width)} × ${String(pixels.height)}${kind === "picture" ? " px" : ""}`}
          >
            <Seg
              label="Size"
              value={size}
              options={SIZES.filter((o) => kind !== "picture" || o.id !== "720p")}
              onChange={setSize}
            />
          </Field>
          {kind !== "picture" ? (
            <>
              {kind === "video" ? (
                <Field label="Format">
                  <Seg
                    label="Format"
                    value={videoFormat}
                    options={[
                      { id: "mp4", label: "MP4" },
                      { id: "webm", label: "WebM" },
                    ]}
                    onChange={setVideoFormat}
                  />
                </Field>
              ) : null}
              <Field label="Frame rate">
                <Seg
                  label="Frame rate"
                  value={fps}
                  options={FRAME_RATES.map((v) => ({ id: v, label: String(v) }))}
                  onChange={setFps}
                />
                {kind === "gif" ? (
                  <p className="text-xs text-muted-foreground">Higher rates make larger files</p>
                ) : null}
              </Field>
              <Field
                label="Repeats in the loop"
                value={`${String(repeats)} × ${String(scene.loop)} s`}
              >
                <Seg
                  label="Repeats in the loop"
                  value={repeats}
                  options={REPEATS.map((v) => ({ id: v, label: String(v) }))}
                  onChange={setRepeats}
                />
              </Field>
            </>
          ) : (
            <Field
              label="Still frame"
              value={`${posterSeconds(scene).toFixed(1)} s of ${String(scene.loop)} s`}
            >
              <p className="text-xs text-muted-foreground">
                The moment you chose with the marker on the timeline.
              </p>
            </Field>
          )}
          {kind === "video" ? (
            <Field label="Quality" value={QUALITY_STEPS.find((q) => q.id === quality)?.label ?? ""}>
              <input
                type="range"
                aria-label="Quality"
                className="lg-slider"
                min={0}
                max={2}
                step={1}
                value={QUALITY_STEPS.findIndex((q) => q.id === quality)}
                style={
                  {
                    "--lg-fill": `${String((QUALITY_STEPS.findIndex((q) => q.id === quality) / 2) * 100)}%`,
                  } as React.CSSProperties
                }
                onChange={(e) => {
                  setQuality(QUALITY_STEPS[Number(e.target.value)]?.id ?? "high");
                }}
              />
            </Field>
          ) : null}
          {kind === "gif" ? (
            <Field label="Colours">
              <Seg
                label="Colours"
                value={colours}
                options={GIF_COLOURS.map((v) => ({ id: v, label: String(v) }))}
                onChange={setColours}
              />
            </Field>
          ) : null}
          {kind === "picture" ? (
            <Field label="Format">
              <Seg
                label="Picture format"
                value={pictureFormat}
                options={[
                  { id: "png", label: "PNG" },
                  { id: "jpg", label: "JPG" },
                  { id: "webp", label: "WebP" },
                ]}
                onChange={setPictureFormat}
              />
            </Field>
          ) : null}
          <p
            data-testid="export-estimate"
            className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-[13px]"
          >
            <Info aria-hidden className="size-4 text-muted-foreground" />
            {kind === "picture"
              ? `About ${formatBytes(bytes)}`
              : `${known === undefined ? "Measuring the size…" : `About ${formatBytes(bytes)}`} · ${
                  plan.shortened
                    ? "shortened"
                    : `${String(Math.round(plan.seconds))} s · ${String(plan.frames)} frames`
                }`}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              data-autofocus
              disabled={blocked || (canVideo === null && kind === "video")}
              className="gap-1.5"
              onClick={() => {
                void start();
              }}
            >
              <Download aria-hidden />
              {plan.shortened && kind !== "picture" ? "Export shortened version" : "Export"}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/**
 * The export of an animated background from the normal Export dialog ("Video / GIF"): the same dialog as in the Studio,
 * on a copy of the document's scene (nothing in the document changes).
 */
export function AnimatedExportDialog({
  base,
  name,
  onClose,
}: {
  base: BaseImage;
  name: string;
  onClose: () => void;
}) {
  const { editor } = useStores();
  const store = useMemo(() => {
    const background = editor.getState().project.presentation.background;
    return background.type === "shader"
      ? createStudioStore(structuredClone(background), { name, playing: false })
      : null;
    // The scene the document has when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!store) return null;
  return (
    <StudioProvider store={store}>
      <StudioExportDialog base={base} onClose={onClose} />
    </StudioProvider>
  );
}
