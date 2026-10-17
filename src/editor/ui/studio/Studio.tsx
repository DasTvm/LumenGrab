import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Dices, Download, Pencil, Snowflake, Bookmark } from "lucide-react";
import { Button } from "@/ui/components/button";
import { useReducedMotion } from "@/ui/lib/use-reduced-motion";
import { randomize, sceneProblem } from "@/shader/edit";
import { ANIMATED_LOOKS, TEMPLATES } from "@/shader/scenes";
import type { ShaderLayer as ShaderLayerLike } from "@/shader/types";
import type { BaseImage } from "../base-image";
import { isTyping } from "../commands";
import { useStores } from "../context";
import { StudioProvider, useStudio, useStudioStore } from "./context";
import { DiscardDialog, NewShaderDialog, SaveShaderDialog, TooLargeDialog } from "./dialogs";
import { ShaderEditor } from "./ShaderEditor";
import { StudioExportDialog } from "./ExportDialog";
import { customValues, parsePragmas } from "@/shader/custom";
import { shadersStore } from "@/shader/shader-instance";
import {
  FreezeDialog,
  SaveLookDialog,
  ConfirmDialog,
  type SaveLookChoice,
} from "../presentation/dialogs";
import { lookFromPresentation } from "@/presentation/looks";
import { computeLayout } from "@/presentation/compose";
import { renderFramePng } from "@/shader/freeze";
import { looksStore } from "../presentation/looks-instance";
import { usePictureWidth, usePictureSize } from "../presentation/use-presentation";
import { Inspector } from "./Inspector";
import { Preview } from "./Preview";
import { duplicate, remove, StackPanel } from "./StackPanel";
import { createStudioStore, isDirty } from "./studio-store";
import { Timeline } from "./Timeline";
import { DecimalBox } from "./parts";

/** Moves the preview's clock while it plays. */
function useTransport(): void {
  const store = useStudioStore();
  const playing = useStudio((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    let shown = last;
    let seamClock = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      const state = store.getState();
      const loop = state.scene.loop;
      let t: number;
      if (state.seam) {
        // The last and the first moments, round and round: the end must flow into the start.
        const window_ = Math.min(1.6, loop);
        seamClock = (seamClock + dt * state.speed) % window_;
        t = (((loop - window_ / 2 + seamClock) % loop) + loop) % loop;
      } else {
        t = (state.time + dt * state.speed) % loop;
      }
      if (now - shown < 33) return;
      shown = now;
      state.setTime(t);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing, store]);
}

function Header({ onApply, onCancel }: { onApply: () => void; onCancel: () => void }) {
  const store = useStudioStore();
  const name = useStudio((s) => s.name);
  const loop = useStudio((s) => s.scene.loop);
  const seed = useStudio((s) => s.scene.seed);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      <button
        type="button"
        aria-label="Back to the editor"
        className="flex size-8 items-center justify-center rounded-md hover:bg-muted"
        onClick={onCancel}
      >
        <ArrowLeft aria-hidden className="size-4" />
      </button>
      <h1 className="text-sm font-semibold">Background Studio</h1>
      <span className="h-5 w-px bg-border" aria-hidden />
      <label className="flex h-9 w-[200px] items-center gap-2 rounded-lg bg-muted px-3 text-[13px] focus-within:ring-2 focus-within:ring-ring">
        <Pencil aria-hidden className="size-3.5 text-muted-foreground" />
        <input
          aria-label="Look name"
          value={name}
          maxLength={40}
          className="min-w-0 flex-1 bg-transparent outline-none"
          onChange={(e) => {
            store.getState().setName(e.target.value);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
          }}
        />
      </label>
      <span className="flex-1" />
      <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
        Loop
        <DecimalBox
          label="Loop length"
          value={loop}
          min={1}
          max={60}
          step={1}
          decimals={0}
          unit="s"
          className="h-9 w-[68px] text-[13px]"
          onChange={(v) => {
            const next = Math.round(v);
            store
              .getState()
              .change((s) => ({ ...s, loop: next, poster: Math.min(s.poster, next - 0.1) }));
            if (store.getState().time >= next) store.getState().setTime(0);
          }}
        />
      </label>
      <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
        Seed
        <DecimalBox
          label="Seed"
          value={seed}
          min={0}
          max={4294967295}
          step={1}
          decimals={0}
          className="h-9 w-[96px] text-[13px]"
          onChange={(v) => {
            store.getState().change((s) => ({ ...s, seed: Math.round(v) }));
          }}
        />
        <button
          type="button"
          aria-label="Randomize"
          title="Randomize: a new seed and new palette colours"
          className="flex size-9 items-center justify-center rounded-lg border border-border bg-background text-foreground hover:bg-muted"
          onClick={() => {
            store.getState().change((s) => randomize(s, Math.floor(Math.random() * 99999)));
          }}
        >
          <Dices aria-hidden className="size-4" />
        </button>
      </label>
      <span className="flex-1" />
      <Button
        variant="outline"
        className="h-9 gap-1.5 text-[13px]"
        onClick={() => {
          store.getState().setDialog("freeze");
        }}
      >
        <Snowflake aria-hidden className="size-3.5" /> Freeze
      </Button>
      <Button
        variant="outline"
        className="h-9 gap-1.5 text-[13px]"
        onClick={() => {
          store.getState().setDialog("export");
        }}
      >
        <Download aria-hidden className="size-3.5" /> Export
      </Button>
      <Button
        variant="outline"
        className="h-9 gap-1.5 text-[13px]"
        onClick={() => {
          store.getState().setDialog("save-look");
        }}
      >
        <Bookmark aria-hidden className="size-3.5" /> Save as my look
      </Button>
      <Button variant="outline" className="h-9 text-[13px]" onClick={onCancel}>
        Cancel
      </Button>
      <button
        type="button"
        className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-brand-foreground hover:opacity-90"
        onClick={onApply}
      >
        <Check aria-hidden className="size-3.5" /> Apply
      </button>
    </header>
  );
}

function Shell({ base, onClose }: { base: BaseImage; onClose: () => void }) {
  const store = useStudioStore();
  const { editor } = useStores();
  const dialog = useStudio((s) => s.dialog);
  const name = useStudio((s) => s.name);
  const notice = useStudio((s) => s.notice);
  const editorTarget = useStudio((s) => s.editor);
  const dialogLayer = useStudio((s) => s.dialogLayer);
  const sceneNow = useStudio((s) => s.scene);
  const [replaceShader, setReplaceShader] = useState<{
    name: string;
    keepSettings: boolean;
  } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const { ui, session } = useStores();
  const width = usePictureWidth();
  const size = usePictureSize();
  const [freeze, setFreeze] = useState<{ bytes: Uint8Array; url: string; seconds: number } | null>(
    null,
  );
  const [replaceLook, setReplaceLook] = useState<SaveLookChoice | null>(null);
  useTransport();

  useEffect(() => {
    if (dialog !== "freeze") return;
    store.getState().setDialog(null);
    store.getState().setPlaying(false);
    const state = store.getState();
    const presentation = {
      ...editor.getState().project.presentation,
      enabled: true,
      background: state.scene,
    };
    const layout = computeLayout(size, presentation);
    void renderFramePng(
      state.scene,
      layout.canvas.width,
      layout.canvas.height,
      state.time,
      true,
    ).then((frame) => {
      if (!frame) {
        state.setNotice("This computer cannot draw the frame.");
        return;
      }
      setFreeze({
        bytes: frame.bytes,
        url: URL.createObjectURL(new Blob([new Uint8Array(frame.bytes)], { type: "image/png" })),
        seconds: state.time,
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog]);

  const saveShader = async (choice: { name: string; keepSettings: boolean }, replace: boolean) => {
    const layer = store.getState().scene.layers.find((l) => l.id === store.getState().dialogLayer);
    if (!layer?.code) return;
    const specs = parsePragmas(layer.code).params.map((p) => p.spec);
    const result = await shadersStore.getState().saveShader(
      {
        name: choice.name,
        role: layer.role ?? "generator",
        code: layer.code,
        values: choice.keepSettings ? customValues(specs, layer.params) : {},
      },
      { replace },
    );
    if (result.status === "exists") {
      setReplaceShader(choice);
      return;
    }
    setReplaceShader(null);
    store.getState().setDialog(null);
    ui.getState().pushToast({ icon: "saved", text: `Saved “${result.shader.name}” to My shaders` });
  };

  const saveLook = async (choice: SaveLookChoice, replace: boolean) => {
    const presentation = {
      ...editor.getState().project.presentation,
      enabled: true,
      background: store.getState().scene,
    };
    const made = lookFromPresentation(presentation, choice.include, width, "x", "x");
    const result = await looksStore.getState().saveLook(choice.name, made.parts, { replace });
    if (result.status === "exists") {
      setReplaceLook(choice);
      return;
    }
    setReplaceLook(null);
    store.getState().setDialog(null);
    if (choice.makeDefault) await looksStore.getState().setDefault(result.look);
    ui.getState().pushToast({ icon: "saved", text: `Saved as “${result.look.name}”` });
  };

  const apply = () => {
    const scene = store.getState().scene;
    if (sceneProblem(scene) !== null) {
      store.getState().setDialog("too-large");
      return;
    }
    editor.getState().change((project) => {
      project.presentation.background = structuredClone(scene);
      project.presentation.enabled = true;
    });
    onClose();
  };
  const cancel = () => {
    if (isDirty(store.getState())) store.getState().setDialog("discard");
    else onClose();
  };

  useEffect(() => {
    root.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const state = store.getState();
      if (state.dialog !== null || state.editor !== null) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]:not([data-studio])')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z" && !isTyping(e.target)) {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      } else if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        state.setPlaying(!state.playing);
      } else if (mod && e.key.toLowerCase() === "d" && state.selected) {
        e.preventDefault();
        duplicate(store, state.selected);
      } else if ((e.key === "Delete" || e.key === "Backspace") && state.selected) {
        e.preventDefault();
        remove(store, state.selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  return (
    <div className="fixed inset-0 z-40 bg-black/40 p-3">
      <div
        ref={root}
        role="dialog"
        aria-modal="true"
        aria-label="Background Studio"
        data-studio
        tabIndex={-1}
        className="relative flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_20px_60px_rgb(0_0_0/0.35)] outline-none"
      >
        <Header onApply={apply} onCancel={cancel} />
        <div className="flex min-h-0 flex-1">
          <StackPanel
            onWriteShader={() => {
              store.getState().setDialog("new-shader");
            }}
          />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Preview base={base} />
            <Timeline />
          </div>
          <Inspector />
        </div>
        {editorTarget ? (
          <ShaderEditor
            key={editorTarget.kind === "layer" ? editorTarget.id : "new"}
            target={editorTarget}
            base={base}
            onClose={() => {
              store.getState().openEditor(null);
            }}
          />
        ) : null}
        {notice ? (
          <div
            role="status"
            className="absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-foreground px-4 py-2 text-[13px] text-background shadow-lg"
          >
            {notice}
            <button
              type="button"
              className="underline"
              onClick={() => {
                store.getState().setNotice(null);
              }}
            >
              Dismiss
            </button>
          </div>
        ) : null}
      </div>
      {dialog === "discard" ? (
        <DiscardDialog
          name={name}
          onKeep={() => {
            store.getState().setDialog(null);
          }}
          onDiscard={onClose}
        />
      ) : null}
      {freeze ? (
        <FreezeDialog
          url={freeze.url}
          seconds={freeze.seconds}
          onCancel={() => {
            URL.revokeObjectURL(freeze.url);
            setFreeze(null);
          }}
          onConfirm={(keep) => {
            void (async () => {
              const scene = store.getState().scene;
              if (keep) {
                const count = looksStore
                  .getState()
                  .looks.filter((l) => l.parts.background?.type === "shader").length;
                await looksStore
                  .getState()
                  .saveLook(`Animated ${String(count + 1)}`, { background: scene });
              }
              const named = await session.addAsset(freeze.bytes);
              URL.revokeObjectURL(freeze.url);
              setFreeze(null);
              if ("error" in named) {
                store.getState().setNotice(named.error);
                return;
              }
              editor.getState().change((project) => {
                project.presentation.background = {
                  type: "image",
                  asset: named.name,
                  fit: "cover",
                };
                project.presentation.enabled = true;
              });
              onClose();
            })();
          }}
        />
      ) : null}
      {dialog === "save-look" ? (
        <SaveLookDialog
          presentation={{
            ...editor.getState().project.presentation,
            enabled: true,
            background: store.getState().scene,
          }}
          width={width}
          suggestedName={name}
          backgroundImage={null}
          onCancel={() => {
            store.getState().setDialog(null);
          }}
          onSave={(choice) => {
            void saveLook(choice, false);
          }}
        />
      ) : null}
      {replaceLook ? (
        <ConfirmDialog
          title={`Replace “${replaceLook.name}”?`}
          body="You already have a look with this name. Replacing it can't be undone."
          confirm="Replace"
          onCancel={() => {
            setReplaceLook(null);
          }}
          onConfirm={() => {
            void saveLook(replaceLook, true);
          }}
        />
      ) : null}
      {dialog === "export" ? (
        <StudioExportDialog
          base={base}
          onClose={() => {
            store.getState().setDialog(null);
          }}
        />
      ) : null}
      {dialog === "new-shader" ? (
        <NewShaderDialog
          onCancel={() => {
            store.getState().setDialog(null);
          }}
          onOpen={(choice) => {
            store.getState().setDialog(null);
            store.getState().openEditor({ kind: "new", ...choice });
          }}
        />
      ) : null}
      {dialog === "save-shader" && dialogLayer ? (
        <SaveShaderDialog
          initialName={sceneNow.layers.find((l) => l.id === dialogLayer)?.name ?? "My shader"}
          summary={shaderSummary(sceneNow.layers.find((l) => l.id === dialogLayer))}
          onCancel={() => {
            store.getState().setDialog(null);
          }}
          onSave={(choice) => {
            void saveShader(choice, false);
          }}
        />
      ) : null}
      {replaceShader ? (
        <ConfirmDialog
          title={`Replace “${replaceShader.name}”?`}
          body="You already have a shader with this name. Replacing it can't be undone."
          confirm="Replace"
          onCancel={() => {
            setReplaceShader(null);
          }}
          onConfirm={() => {
            void saveShader(replaceShader, true);
          }}
        />
      ) : null}
      {dialog === "too-large" ? (
        <TooLargeDialog
          onReview={() => {
            store.getState().setDialog(null);
          }}
          onCancel={() => {
            store.getState().setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** The Background Studio (design: Studio / Overview): opens on the document's background, works on a copy, and Apply puts it back as one undo step. */
export function StudioHost({ base }: { base: BaseImage }) {
  const { ui, editor } = useStores();
  const reduced = useReducedMotion();
  const store = useMemo(() => {
    const background = editor.getState().project.presentation.background;
    const scene =
      background.type === "shader" ? structuredClone(background) : (TEMPLATES[0]?.make() ?? null);
    if (!scene) throw new Error("There is no template to start from.");
    const known = ANIMATED_LOOKS.find(
      (l) => JSON.stringify({ ...l.make(), poster: 0 }) === JSON.stringify({ ...scene, poster: 0 }),
    );
    return createStudioStore(scene, { name: known?.name ?? "New look", playing: !reduced });
    // The Studio starts from what the document has when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <StudioProvider store={store}>
      <Shell
        base={base}
        onClose={() => {
          ui.getState().setStudio(false);
        }}
      />
    </StudioProvider>
  );
}

/** The settings of a layer with code in words: `Speed 1.0, tint #C8FF2E, soft edges on`. */
function shaderSummary(layer: ShaderLayerLike | undefined): string {
  if (!layer?.code) return "No settings.";
  const specs = parsePragmas(layer.code).params.map((p) => p.spec);
  if (specs.length === 0) return "This shader has no settings.";
  const values = customValues(specs, layer.params);
  return specs
    .map((spec) => {
      const v = values[spec.id];
      if (typeof v === "boolean") return `${spec.label.toLowerCase()} ${v ? "on" : "off"}`;
      if (typeof v === "number") return `${spec.label} ${v.toFixed(spec.type === "int" ? 0 : 1)}`;
      return `${spec.label.toLowerCase()} ${typeof v === "string" ? v : ""}`.trim();
    })
    .join(", ");
}
