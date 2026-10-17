import { useState } from "react";
import { Image as ImageIcon, Play, Plus, Info, Star, WandSparkles } from "lucide-react";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { useReducedMotion } from "@/ui/lib/use-reduced-motion";
import { cn } from "@/ui/lib/utils";
import type { Look } from "@/presentation/looks";
import { computeLayout } from "@/presentation/compose";
import { renderFramePng } from "@/shader/freeze";
import { webglAvailable } from "@/shader/renderer";
import { ANIMATED_LOOKS, TEMPLATES } from "@/shader/scenes";
import { posterSeconds } from "@/shader/scene";
import type { ShaderScene } from "@/shader/types";
import { Slider } from "../controls";
import { useStores, useUi } from "../context";
import { applyLookToDocument } from "./apply-look";
import { FreezeDialog } from "./dialogs";
import { looksStore, useLooks } from "./looks-instance";
import { LookThumb } from "./LookThumb";
import { usePictureSize, usePictureWidth, usePresentation } from "./use-presentation";

/** The animated looks that ship, as looks (a background and nothing else). */
export const ANIMATED_LOOK_LIST: readonly Look[] = ANIMATED_LOOKS.map((l) => ({
  id: l.id,
  name: l.name,
  parts: { background: l.make() },
}));

/** Two scenes are the same look when everything but the still-frame moment is the same. */
function sameLook(a: ShaderScene, b: ShaderScene): boolean {
  return JSON.stringify({ ...a, poster: 0 }) === JSON.stringify({ ...b, poster: 0 });
}

const WIDTH = 88;
const HEIGHT = 58;

function Tile({
  look,
  selected,
  isDefault,
  onApply,
  onMakeDefault,
}: {
  look: Look;
  selected: boolean;
  isDefault: boolean;
  onApply: () => void;
  onMakeDefault: () => void;
}) {
  return (
    <div className="group relative flex min-w-0 flex-col gap-1.5 text-[11px] font-medium">
      {isDefault ? (
        <span
          role="img"
          aria-label="Default look"
          className="pointer-events-none absolute top-1 right-1 z-10 flex size-[18px] items-center justify-center rounded-full bg-brand text-brand-foreground shadow-sm"
        >
          <Star aria-hidden className="size-3 fill-current" />
        </span>
      ) : (
        <button
          type="button"
          aria-label={`Use ${look.name} as default`}
          title="Use as default"
          className="absolute top-1 right-1 z-10 flex size-[22px] items-center justify-center rounded-full bg-card/90 opacity-0 shadow-sm group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={onMakeDefault}
        >
          <Star aria-hidden className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={look.name}
        className="flex min-w-0 flex-col gap-1.5 text-left"
        onClick={onApply}
      >
        <span
          className={cn(
            "relative block overflow-hidden rounded-lg",
            selected ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "ring-1 ring-border",
          )}
        >
          <LookThumb look={look} width={WIDTH} height={HEIGHT} fill />
          <span
            aria-hidden
            className="absolute bottom-1 left-1 flex size-4 items-center justify-center rounded-full bg-white/90 text-neutral-900"
          >
            <Play className="size-2 fill-current" />
          </span>
        </span>
        <span className={cn("truncate", selected ? "text-foreground" : "text-muted-foreground")}>
          {look.name}
        </span>
      </button>
    </div>
  );
}

/**
 * The Animated tab of the background section (design: Studio / Animated tab): the animated looks, yours,
 * the Studio, the still frame, whether the animation plays in the editor, and "Use this frame as picture".
 */
export function AnimatedEditor({ bg }: { bg: ShaderScene }) {
  const { editor, ui, session } = useStores();
  const { p, set, start, end } = usePresentation();
  const width = usePictureWidth();
  const size = usePictureSize();
  const own = useLooks((s) => s.looks).filter((l) => l.parts.background?.type === "shader");
  const animate = useUi((s) => s.animate);
  const reduced = useReducedMotion();
  const canvasOk = webglAvailable();
  const [freeze, setFreeze] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (look: Look) => {
    void applyLookToDocument(look, { editor, ui, session, width });
  };
  const defaultLook = useLooks((s) => s.defaultLook);
  const makeDefault = (look: Look) => {
    void looksStore.getState().setDefault(look);
    ui.getState().pushToast({ icon: "default", text: `${look.name} is now your default look` });
  };
  const sceneOf = (look: Look): ShaderScene | null => {
    const b = look.parts.background;
    return b?.type === "shader" ? b : null;
  };
  const active = (look: Look) => {
    const s = sceneOf(look);
    return s !== null && sameLook(s, bg);
  };
  const poster = Math.round(posterSeconds(bg) * 10) / 10;

  const prepareFreeze = async () => {
    setError(null);
    const layout = computeLayout({ width: size.width, height: size.height }, p);
    const frame = await renderFramePng(bg, layout.canvas.width, layout.canvas.height, poster, true);
    if (!frame) {
      setError("This computer cannot draw the frame.");
      return;
    }
    setFreeze({
      bytes: frame.bytes,
      url: URL.createObjectURL(new Blob([new Uint8Array(frame.bytes)], { type: "image/png" })),
    });
  };
  const confirmFreeze = async (keepAnimation: boolean) => {
    if (!freeze) return;
    const { bytes } = freeze;
    if (keepAnimation) {
      const name = `Animated ${String(own.length + 1)}`;
      await looksStore.getState().saveLook(name, { background: bg });
    }
    const named = await session.addAsset(bytes);
    URL.revokeObjectURL(freeze.url);
    setFreeze(null);
    if ("error" in named) {
      setError(named.error);
      return;
    }
    set((draft) => {
      draft.background = { type: "image", asset: named.name, fit: "cover" };
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {!canvasOk ? (
        <p
          role="status"
          className="flex gap-2 rounded-md border border-amber-300/60 bg-amber-50 p-2.5 text-[13px] text-amber-950"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Animated backgrounds need WebGL. A plain colour is used.
        </p>
      ) : reduced ? (
        <p
          role="status"
          className="flex gap-2 rounded-md bg-muted p-2.5 text-[13px] text-muted-foreground"
        >
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          Animation is paused because Reduce Motion is on in your system settings.
        </p>
      ) : null}
      <div className="grid grid-cols-3 gap-x-2 gap-y-2.5">
        {ANIMATED_LOOK_LIST.map((look) => (
          <Tile
            key={look.id}
            look={look}
            selected={active(look)}
            isDefault={defaultLook?.id === look.id}
            onApply={() => {
              apply(look);
            }}
            onMakeDefault={() => {
              makeDefault(look);
            }}
          />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Your animated looks
        </h4>
        {own.length === 0 ? (
          <p className="rounded-lg bg-muted/60 px-3 py-3 text-center text-[13px] text-muted-foreground">
            No animated looks of your own yet. Build one in the Studio and save it here.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-x-2 gap-y-2.5">
            {own.map((look) => (
              <Tile
                key={look.id}
                look={look}
                selected={active(look)}
                isDefault={defaultLook?.id === look.id}
                onApply={() => {
                  apply(look);
                }}
                onMakeDefault={() => {
                  makeDefault(look);
                }}
              />
            ))}
            <button
              type="button"
              className="flex min-w-0 flex-col gap-1.5 text-left text-[11px] font-medium"
              onClick={() => {
                const blank = TEMPLATES.find((t) => t.id === "blank")?.make();
                if (blank) {
                  set((draft) => {
                    draft.background = blank;
                  });
                }
                ui.getState().setStudio(true);
              }}
            >
              <span className="flex h-[58px] items-center justify-center rounded-lg bg-muted ring-1 ring-border">
                <Plus aria-hidden className="size-[18px] text-muted-foreground" />
              </span>
              <span className="truncate text-muted-foreground">New look</span>
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="flex h-[38px] items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90"
        onClick={() => {
          ui.getState().setStudio(true);
        }}
      >
        <WandSparkles aria-hidden className="size-3.5" />
        Open Background Studio
      </button>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <h4 className="text-[13px] font-semibold">Still frame</h4>
          <span className="text-xs text-muted-foreground">{`${poster.toFixed(1)} s of ${String(bg.loop)} s`}</span>
        </div>
        <Slider
          label="Still frame"
          value={Math.round(poster * 10)}
          min={0}
          max={Math.max(1, Math.round(bg.loop * 10) - 1)}
          onStart={start}
          onEnd={end}
          onChange={(v) => {
            set((draft) => {
              if (draft.background.type === "shader") draft.background.poster = v / 10;
            });
          }}
        />
        <p className="text-[11px] font-medium text-muted-foreground">
          Used for exports as a picture, and when the animation is off.
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-xs font-medium">Animate in editor</span>
          <span className="text-[11px] text-muted-foreground">
            {reduced ? "Off while Reduce Motion is on." : "Plays the background while you edit."}
          </span>
        </div>
        <Switch
          aria-label="Animate in editor"
          checked={animate && !reduced}
          disabled={reduced}
          onCheckedChange={(on) => {
            ui.getState().setAnimate(on);
          }}
        />
      </div>
      <Button
        variant="outline"
        className="h-[34px] gap-1.5 text-[13px]"
        disabled={!canvasOk}
        onClick={() => void prepareFreeze()}
      >
        <ImageIcon aria-hidden className="size-3.5" />
        Use this frame as picture
      </Button>
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      {freeze ? (
        <FreezeDialog
          url={freeze.url}
          seconds={poster}
          onCancel={() => {
            URL.revokeObjectURL(freeze.url);
            setFreeze(null);
          }}
          onConfirm={(keep) => {
            void confirmFreeze(keep);
          }}
        />
      ) : null}
    </div>
  );
}
