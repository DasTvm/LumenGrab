import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Dices, Download, Pencil, Snowflake, Bookmark } from "lucide-react";
import { Button } from "@/ui/components/button";
import { useReducedMotion } from "@/ui/lib/use-reduced-motion";
import { addCustom, randomize, sceneProblem } from "@/shader/edit";
import { minFrameGap } from "@/shader/pace";
import { ANIMATED_LOOKS, findShaderLayer, sceneWithShader, TEMPLATES } from "@/shader/scenes";
import type { BaseImage } from "../base-image";
import { isTyping } from "../commands";
import { useStores } from "../context";
import { StudioProvider, useStudio, useStudioStore } from "./context";
import { DiscardDialog, TooLargeDialog } from "./dialogs";
import { ShaderEditor } from "./ShaderEditor";
import { StudioExportDialog } from "./ExportDialog";
import { EXAMPLES } from "@/shader/custom";
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
      if (now - shown < minFrameGap()) return;
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

  /** "Write new shader": a layer that already runs an example, and the editor on it. */
  const writeShader = () => {
    const example = EXAMPLES[0];
    if (!example) return;
    const made = addCustom(store.getState().scene, example.role, "Untitled shader", example.code);
    if (!made) {
      store.getState().setNotice("The stack is full. Remove a layer first.");
      return;
    }
    session.noteOwnCode(example.code);
    store.getState().change(() => made.scene);
    store.getState().select(made.id);
    store.getState().openEditor({ kind: "layer", id: made.id, fresh: true });
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
          <StackPanel onWriteShader={writeShader} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Preview base={base} />
            <Timeline />
          </div>
          <Inspector />
        </div>
        {editorTarget ? (
          <ShaderEditor
            key={editorTarget.id}
            target={editorTarget}
            onClose={() => {
              store.getState().openEditor(null);
              // Opened from the Animated tab: Done is the end of the whole thing, the shader is the background.
              if (store.getState().standalone) apply();
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
  const { ui, editor, session } = useStores();
  const reduced = useReducedMotion();
  const store = useMemo(() => {
    const background = editor.getState().project.presentation.background;
    const current = background.type === "shader" ? structuredClone(background) : null;
    const start = ui.getState().studioStart;
    // Straight into the shader editor: a new shader (it already runs an example), or one of My shaders.
    if (start) {
      const example = EXAMPLES[0];
      const mine =
        start.kind === "shader"
          ? shadersStore.getState().shaders.find((x) => x.id === start.shaderId)
          : undefined;
      const source =
        mine ??
        (example
          ? { name: "Untitled shader", role: example.role, code: example.code, values: {} }
          : null);
      if (source) {
        const own = current ? findShaderLayer(current, source) : undefined;
        const made =
          own && current ? { scene: current, layerId: own.id } : sceneWithShader(source, current);
        // No notification while rendering: the pages are told once the Studio is on screen.
        session.noteOwnCode(source.code, false);
        return createStudioStore(made.scene, {
          name: source.name,
          playing: !reduced,
          ...(reduced ? { time: 0 } : {}),
          standalone: true,
          editor: { kind: "layer", id: made.layerId, ...(mine ? {} : { fresh: true }) },
        });
      }
    }
    const scene = current ?? TEMPLATES[0]?.make() ?? null;
    if (!scene) throw new Error("There is no template to start from.");
    const known = ANIMATED_LOOKS.find(
      (l) => JSON.stringify({ ...l.make(), poster: 0 }) === JSON.stringify({ ...scene, poster: 0 }),
    );
    return createStudioStore(scene, {
      name: known?.name ?? "New look",
      playing: !reduced,
      ...(reduced ? { time: 0 } : {}),
    });
    // The Studio starts from what the document has when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (ui.getState().studioStart) ui.getState().bumpCode();
  }, [ui]);
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
