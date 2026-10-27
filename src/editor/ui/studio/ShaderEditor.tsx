import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CircleAlert,
  CircleCheck,
  CircleQuestionMark,
  Copy,
  FileCode2,
  Lock,
  Pause,
  Play,
  Plus,
  Redo2,
  Scale,
  ShieldAlert,
  SlidersHorizontal,
  Undo2,
  WandSparkles,
  X,
  ChevronDown,
} from "lucide-react";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import { drawShaderBackground } from "@/presentation/draw-presentation";
import { setCustom } from "@/shader/edit";
import { addSetting, uniqueName } from "@/shader/code-edit";
import {
  aiBrief,
  checkCustomCode,
  customValues,
  detectRole,
  EXAMPLES,
  parsePragmas,
  type Example,
} from "@/shader/custom";
import { sharedRenderer } from "@/shader/renderer";
import { shadersStore, useShaders } from "@/shader/shader-instance";
import type { ShaderLayer, ShaderParamValue, ShaderScene } from "@/shader/types";
import { useStores, useUi } from "../context";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { useStudio, useStudioStore } from "./context";
import { MenuLabel, Popover } from "./parts";
import { SettingControl } from "./SettingControl";
import type { ShaderEditorTarget } from "./studio-store";

type Status =
  | { state: "idle" }
  | { state: "compiled"; ms: number; names: string[]; problems: number }
  | { state: "error"; line: number | null; message: string }
  | { state: "too-long"; message: string };

/** How long after the last key the shader is checked, put in the layer and kept in Your shaders. */
const COMMIT_MS = 400;
const KEEP_MS = 700;

function ToolButton({
  label,
  icon: Icon,
  off,
  onClick,
}: {
  label: string;
  icon: typeof Undo2;
  off: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={off}
      className="flex size-8 items-center justify-center rounded-md text-foreground hover:bg-muted disabled:opacity-40"
      onClick={onClick}
    >
      <Icon aria-hidden className="size-4" />
    </button>
  );
}

/** The little round gradient of an example. */
function Chip({ example }: { example: Example }) {
  const colours: Record<string, string> = {
    plasma: "linear-gradient(135deg,#34d399,#a3e635)",
    "soft-clouds": "linear-gradient(135deg,#bae6fd,#38bdf8)",
    starfield: "linear-gradient(135deg,#0f172a,#1e293b)",
    "light-sweep": "linear-gradient(135deg,#fdba74,#fff7ed)",
    "chromatic-wobble": "linear-gradient(135deg,#38bdf8,#fb923c)",
    "pixel-melt": "linear-gradient(135deg,#052e16,#16a34a)",
  };
  return (
    <span
      aria-hidden
      className="size-9 shrink-0 rounded-lg border border-black/5 bg-muted"
      style={{ background: colours[example.id] }}
    />
  );
}

/** What a shader can use, on one page (design: Shader flow / 4): the inputs, the helpers, the settings, and a brief for an AI. */
function Help({
  effect,
  paletteSize,
  brief,
  onCopy,
  onClose,
}: {
  effect: boolean;
  paletteSize: number;
  brief: string;
  onCopy: (text: string) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const parent = root.current?.parentElement;
      if (parent && !parent.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, [onClose]);
  const row = (name: string, meaning: string) => (
    <div key={name} className="grid grid-cols-[130px_1fr] gap-3">
      <dt className="font-mono">{name}</dt>
      <dd className="text-muted-foreground">{meaning}</dd>
    </div>
  );
  return (
    <div
      ref={root}
      role="dialog"
      aria-label="Help for shaders"
      className="absolute top-full right-0 z-40 mt-1 flex max-h-[640px] w-[380px] flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-4 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.18)]"
    >
      <div className="flex items-center">
        <h2 className="flex-1 text-sm font-semibold">What you can use</h2>
        <button
          type="button"
          aria-label="Close help"
          className="flex size-7 items-center justify-center rounded-md hover:bg-muted"
          onClick={onClose}
        >
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <section aria-label="Inputs" className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Inputs
        </h3>
        <dl className="flex flex-col gap-1 text-xs">
          {effect ? row("u_input", "sampler2D · the layers below") : null}
          {row("u_resolution", "vec2 · size in pixels")}
          {row("u_phase", "float · 0 to 1 over the loop")}
          {row("u_seed", "float · from the Seed field")}
          {effect
            ? null
            : row("u_palette[8]", `vec3 · ${String(paletteSize)} colours of the Studio`)}
        </dl>
      </section>
      <section aria-label="Helpers" className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Helpers
        </h3>
        <dl className="flex flex-col gap-1 text-xs">
          {row("noise(vec2)", "smooth value noise")}
          {row("fbm(vec2)", "layered noise")}
          {row("hsv2rgb(vec3)", "colour conversion")}
          {row("rot(float)", "2 × 2 rotation")}
        </dl>
      </section>
      <section aria-label="Settings" className="flex flex-col gap-1.5">
        <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Settings
        </h3>
        <dl className="flex flex-col gap-1 text-xs">
          {row("// @param float a = 1.0 [0, 4]", "slider")}
          {row("// @param color c = #C8FF2E", "colour field")}
          {row("// @param bool b = true", "switch")}
        </dl>
      </section>
      <section aria-label="Ask an AI" className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
          Ask an AI
        </h3>
        <p>
          Copy a ready-made prompt, paste it into any chat assistant, then paste its answer into the
          editor. LumenGrab has no AI of its own and sends nothing anywhere.
        </p>
        <Button
          variant="outline"
          className="h-8 w-fit gap-1.5 text-[13px]"
          onClick={() => {
            onCopy(brief);
          }}
        >
          <Copy aria-hidden className="size-3.5" /> Copy prompt for an AI
        </Button>
      </section>
      <p className="flex gap-2 rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
        <Scale aria-hidden className="mt-0.5 size-3.5 shrink-0" />
        Shaders from other people: check the licence first. Code from Shadertoy and similar sites is
        often not free to reuse. Use your own code, or code under MIT, CC0 or a similar licence.
      </p>
    </div>
  );
}

/**
 * The shader editor (design: Shader flow / 2): your own GLSL, checked as you type, with a live preview and the
 * settings your @param lines make. There is nothing to save or apply: every change goes into the layer, and a shader
 * that works is kept in Your shaders by itself. Done only closes it.
 */
export function ShaderEditor({
  target,
  onClose,
}: {
  target: ShaderEditorTarget;
  onClose: () => void;
}) {
  const store = useStudioStore();
  const { session, ui } = useStores();
  const studioScene = useStudio((s) => s.scene);
  const heavy = useStudio((s) => s.heavy);
  const mine = useShaders((s) => s.shaders);
  const existing: ShaderLayer | undefined = studioScene.layers.find((l) => l.id === target.id);

  // What the layer is when the editor opens; the draft is compared with it to know that something changed.
  const initial = useMemo(
    () => ({
      name: existing?.name ?? "Untitled shader",
      code: existing?.code ?? "",
      values: { ...(existing?.params ?? {}) },
    }),
    // The draft starts from the layer as it is when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code);
  const [values, setValues] = useState(initial.values);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [menu, setMenu] = useState<"examples" | "help" | null>(null);
  const [time, setTime] = useState(studioScene.poster);
  const [playing, setPlaying] = useState(true);
  const [hist, setHist] = useState({ undo: false, redo: false });
  const editorRef = useRef<CodeEditorHandle>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const lastMs = useRef(0);
  const frames = useRef(0);

  // The saved shader this layer is, when it is one: the same name and the same code as when the editor opened.
  const [linkedId, setLinkedId] = useState<string | null>(
    () =>
      mine.find(
        (m) => m.name.toLowerCase() === initial.name.toLowerCase() && m.code === initial.code,
      )?.id ?? null,
  );
  const kept = linkedId !== null;

  // Code from a file that came from outside is read-only and does not run until the user allows it.
  const layerLike = { ...(existing ?? {}), code } as ShaderLayer;
  const documentAllowed = useUi((s) => s.codeAllowed);
  // The gate can change under the editor (the user allows the code, or code of their own is noted).
  useUi((s) => s.codeVersion);
  const allowed = documentAllowed || session.canRun(layerLike);
  const switchedOff = existing !== undefined && heavy.includes(existing.id);

  const role = detectRole(code);
  const params = useMemo(() => parsePragmas(code), [code]);
  const specs = params.params.map((p) => p.spec);
  const resolved = useMemo(() => customValues(specs, values), [specs, values]);
  const signature = JSON.stringify([name, code, values]);
  const initialSignature = target.fresh
    ? ""
    : JSON.stringify([initial.name, initial.code, initial.values]);
  const changed = signature !== initialSignature;

  // Check the code as it is written, and say what happened.
  useEffect(() => {
    if (!allowed) return;
    const timer = setTimeout(() => {
      const check = checkCustomCode(code);
      if (!check.ok && check.kind === "too-long") {
        setStatus({ state: "too-long", message: check.message });
        return;
      }
      const renderer = sharedRenderer("shader-editor");
      if (!renderer) {
        setStatus({
          state: "error",
          line: null,
          message: "WebGL is not available on this computer.",
        });
        return;
      }
      const result = renderer.tryCompile(code);
      if (result.ok) {
        if (result.ms > 0) lastMs.current = result.ms;
        const found = parsePragmas(code);
        setStatus({
          state: "compiled",
          ms: Math.max(1, Math.round(lastMs.current)),
          names: found.params.map((p) => p.spec.id),
          problems: found.problems.length,
        });
      } else {
        setStatus({ state: "error", line: result.line, message: result.message });
      }
    }, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [code, allowed]);

  /** Puts the draft in the layer (one undo step of the Studio), so the stack, the background and the document follow. */
  const commit = () => {
    if (!existing || !allowed) return;
    const own = { ...values, ...resolved } as ShaderLayer["params"];
    session.noteOwnCode(code);
    store.getState().change((s) =>
      setCustom(s, existing.id, {
        name: name.trim() === "" ? "Untitled shader" : name.trim(),
        role,
        code,
        params: own,
      }),
    );
  };

  /** Keeps the shader in Your shaders (a new one, or the change of the one this already is). */
  const keep = async () => {
    const own = { ...values, ...resolved } as Record<string, number | boolean | string>;
    const saved = await shadersStore.getState().keepShader(
      {
        name: name.trim() === "" ? "Untitled shader" : name.trim(),
        role,
        code,
        values: own,
      },
      linkedId ?? undefined,
    );
    setLinkedId(saved.id);
  };
  const compiled = status.state === "compiled";

  useEffect(() => {
    if (!changed) return;
    const timer = setTimeout(commit, COMMIT_MS);
    return () => {
      clearTimeout(timer);
    };
    // The draft is what `signature` says: the timer is set again when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, changed]);
  useEffect(() => {
    if (!changed || !compiled || !allowed) return;
    const timer = setTimeout(() => {
      void keep();
    }, KEEP_MS);
    return () => {
      clearTimeout(timer);
    };
    // The draft is what `signature` says: the timer is set again when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, changed, compiled, allowed]);

  const done = () => {
    if (changed) {
      commit();
      if (compiled && allowed) void keep();
    }
    onClose();
  };

  // The playhead of the little preview.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    let shown = last;
    const loop = studioScene.loop;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (now - shown < 40) return;
      shown = now;
      setTime((t) => (t + dt) % loop);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing, studioScene.loop]);

  // What the preview shows: this layer alone, or on what is below it (an effect).
  const draft: ShaderLayer = useMemo(
    () => ({
      id: "draft",
      kind: "custom",
      name,
      role,
      code,
      enabled: true,
      opacity: 1,
      blend: "normal",
      speed: 0,
      params: values,
    }),
    [name, role, code, values],
  );
  const below: ShaderLayer[] = useMemo(() => {
    if (role !== "effect") return [];
    if (existing) return studioScene.layers.slice(0, studioScene.layers.indexOf(existing));
    return studioScene.layers;
  }, [role, existing, studioScene.layers]);
  const previewScene = useMemo(
    (): ShaderScene => ({ ...studioScene, layers: [...below, draft] }),
    [studioScene, below, draft],
  );

  const draw = useCallback(() => {
    const el = preview.current;
    if (!el || !allowed) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(388 * dpr);
    const h = Math.round(230 * dpr);
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    const ctx = el.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    frames.current += 1;
    const measure = frames.current % 20 === 0;
    const report = drawShaderBackground(ctx, previewScene, w, h, 1, {
      seconds: time,
      trustCustomCode: true,
      purpose: "shader-editor",
      ...(measure ? { measure: true } : {}),
    });
    if (report && existing && report.heavy.includes("draft")) {
      store.getState().change((s) => ({
        ...s,
        layers: s.layers.map((l) => (l.id === existing.id ? { ...l, enabled: false } : l)),
      }));
      store.getState().markHeavy(existing.id);
    }
  }, [allowed, previewScene, time, existing, store]);
  useEffect(() => {
    draw();
  }, [draw]);

  // Keys of the editor: Esc is Done (unless a menu is open), the Studio's own keys stay out of it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A menu, the help or a colour picker takes the first Esc itself.
      if (
        e.key === "Escape" &&
        !e.defaultPrevented &&
        menu === null &&
        document.querySelector('[role="dialog"][aria-label="Colour picker"]') === null
      ) {
        e.preventDefault();
        e.stopPropagation();
        done();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  });

  const loadExample = (example: Example) => {
    setMenu(null);
    setCode(example.code);
    setValues({});
    if (name === "Untitled shader" || EXAMPLES.some((e) => e.name === name)) setName(example.name);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      ui.getState().pushToast({ icon: "saved", text: "Prompt copied. Paste it into your AI." });
    } catch {
      ui.getState().pushToast({ icon: "default", text: "The prompt could not be copied." });
    }
  };
  const brief = aiBrief({
    code,
    example: (EXAMPLES.find((e) => e.role === role) ?? EXAMPLES[0])?.code ?? "",
  });

  const errorLine = status.state === "error" ? status.line : null;
  const chip = !allowed
    ? { label: "Not run", tone: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" }
    : switchedOff
      ? {
          label: "Switched off",
          tone: "bg-muted text-muted-foreground",
          dot: "bg-muted-foreground",
        }
      : status.state === "compiled"
        ? {
            label: kept ? "Saved · works" : "Works",
            tone: "bg-[#e7f7ec] text-[#1a7f45]",
            dot: "bg-[#1a9b54]",
          }
        : status.state === "error"
          ? {
              label: kept ? "Saved · has a mistake" : "Has a mistake",
              tone: "bg-[#fdeaea] text-[#b42318]",
              dot: "bg-[#d92d20]",
            }
          : status.state === "too-long"
            ? { label: "Too long", tone: "bg-[#fdeaea] text-[#b42318]", dot: "bg-[#d92d20]" }
            : {
                label: "Checking",
                tone: "bg-muted text-muted-foreground",
                dot: "bg-muted-foreground",
              };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Shader editor"
      data-studio
      className="absolute inset-0 z-30 flex flex-col bg-card"
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <button
          type="button"
          aria-label="Back"
          className="flex size-8 items-center justify-center rounded-md hover:bg-muted"
          onClick={done}
        >
          <ArrowLeft aria-hidden className="size-4" />
        </button>
        <label className="flex h-9 w-[220px] items-center gap-2 rounded-lg bg-muted px-3 text-[13px] focus-within:ring-2 focus-within:ring-ring">
          <WandSparkles aria-hidden className="size-3.5 text-muted-foreground" />
          <input
            aria-label="Shader name"
            value={name}
            maxLength={40}
            className="min-w-0 flex-1 bg-transparent outline-none"
            onChange={(e) => {
              setName(e.target.value);
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
            }}
          />
        </label>
        <span className="flex-1" />
        <span
          role="status"
          aria-label="Compile status"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium",
            chip.tone,
          )}
        >
          <span aria-hidden className={cn("size-1.5 rounded-full", chip.dot)} />
          {chip.label}
        </span>
        <span className="flex-1" />
        <div className="relative">
          <Button
            variant="outline"
            className="h-9 gap-1.5 text-[13px]"
            aria-haspopup="menu"
            aria-expanded={menu === "examples"}
            onClick={() => {
              setMenu(menu === "examples" ? null : "examples");
            }}
          >
            <BookOpen aria-hidden className="size-3.5" /> Examples{" "}
            <ChevronDown aria-hidden className="size-3.5" />
          </Button>
          <Popover
            open={menu === "examples"}
            onClose={() => {
              setMenu(null);
            }}
            className="max-h-[600px] w-[320px]"
          >
            <div role="menu" aria-label="Examples">
              {(
                [
                  [
                    "Generators",
                    EXAMPLES.filter((e) => e.role === "generator" && !e.id.startsWith("blank")),
                  ],
                  [
                    "Effects",
                    EXAMPLES.filter((e) => e.role === "effect" && !e.id.startsWith("blank")),
                  ],
                  ["Start empty", EXAMPLES.filter((e) => e.id.startsWith("blank"))],
                ] as const
              ).map(([label, list]) => (
                <div key={label}>
                  <MenuLabel>{label}</MenuLabel>
                  {list.map((e) => (
                    <button
                      key={e.id}
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left hover:bg-muted"
                      onClick={() => {
                        loadExample(e);
                      }}
                    >
                      <Chip example={e} />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[13px] font-medium">{e.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{e.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </Popover>
        </div>
        <div className="relative">
          <Button
            variant="outline"
            className="h-9 gap-1.5 text-[13px]"
            aria-haspopup="dialog"
            aria-expanded={menu === "help"}
            onClick={() => {
              setMenu(menu === "help" ? null : "help");
            }}
          >
            <CircleQuestionMark aria-hidden className="size-3.5" /> Help
          </Button>
          {menu === "help" ? (
            <Help
              effect={role === "effect"}
              paletteSize={studioScene.palette.length}
              brief={brief}
              onCopy={(text) => {
                void copy(text);
              }}
              onClose={() => {
                setMenu(null);
              }}
            />
          ) : null}
        </div>
        <button
          type="button"
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-brand-foreground hover:opacity-90"
          onClick={done}
        >
          <Check aria-hidden className="size-3.5" /> Done
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border">
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
            <span className="relative flex h-12 items-center gap-1.5 px-3 font-mono text-[13px] font-medium after:absolute after:right-2 after:bottom-0 after:left-2 after:h-0.5 after:rounded-full after:bg-brand">
              <FileCode2 aria-hidden className="size-3.5" /> Code
            </span>
            {!allowed ? (
              <span className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                <Lock aria-hidden className="size-3" /> Read-only
              </span>
            ) : null}
            <span className="flex-1" />
            <ToolButton
              label="Undo"
              icon={Undo2}
              off={!hist.undo}
              onClick={() => editorRef.current?.undo()}
            />
            <ToolButton
              label="Redo"
              icon={Redo2}
              off={!hist.redo}
              onClick={() => editorRef.current?.redo()}
            />
            <Button
              variant="outline"
              className="h-8 gap-1 px-2.5 text-[13px]"
              disabled={!allowed || params.params.length >= 16}
              onClick={() => {
                setCode(
                  addSetting(code, {
                    id: uniqueName(code),
                    label: "Setting",
                    group: "Settings",
                    type: "number",
                    min: 0,
                    max: 1,
                    step: 0.01,
                    default: 0.5,
                    decimals: 2,
                  }),
                );
              }}
            >
              <Plus aria-hidden className="size-3.5" /> Add a setting
            </Button>
          </div>

          {!allowed ? (
            <div className="flex items-center gap-3 border-b border-border bg-muted/60 px-4 py-3">
              <ShieldAlert aria-hidden className="size-5 shrink-0" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-semibold">
                  This file contains custom shader code
                </span>
                <span className="text-xs text-muted-foreground">
                  It runs only if you allow it. Read the code first if you are not sure where the
                  file comes from.
                </span>
              </div>
              <button
                type="button"
                className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-medium text-brand-foreground hover:opacity-90"
                onClick={() => {
                  void session.allowCode();
                }}
              >
                <Play aria-hidden className="size-3.5" /> Run custom code
              </button>
              <Button variant="outline" className="h-9 text-[13px]" onClick={onClose}>
                Keep off
              </Button>
            </div>
          ) : null}
          {allowed && switchedOff ? (
            <div className="flex items-center gap-3 border-b border-border bg-[#fff4e5] px-4 py-3">
              <CircleAlert aria-hidden className="size-5 shrink-0 text-[#b54708]" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-semibold">
                  This shader is too heavy and was switched off
                </span>
                <span className="text-xs text-muted-foreground">
                  It slowed the preview down too much. Simplify the code, then turn it on again.
                </span>
              </div>
              <Button
                variant="outline"
                className="h-9 text-[13px]"
                onClick={() => {
                  store.getState().clearHeavy(existing.id);
                  store.getState().change((s) => ({
                    ...s,
                    layers: s.layers.map((l) =>
                      l.id === existing.id ? { ...l, enabled: true } : l,
                    ),
                  }));
                }}
              >
                Turn on again
              </Button>
            </div>
          ) : null}

          <CodeEditor
            ref={editorRef}
            value={code}
            readOnly={!allowed}
            errorLine={errorLine}
            onChange={setCode}
            onCursor={() => undefined}
            onHistory={() => {
              setHist({
                undo: editorRef.current?.canUndo() ?? false,
                redo: editorRef.current?.canRedo() ?? false,
              });
            }}
          />

          <div
            role="status"
            aria-label="Result of the compile"
            className={cn(
              "flex shrink-0 items-center gap-3 px-5 py-3",
              !allowed || switchedOff
                ? "bg-muted/60"
                : status.state === "compiled"
                  ? "bg-[#effaf3]"
                  : status.state === "idle"
                    ? "bg-muted/60"
                    : "bg-[#fdf0ef]",
            )}
          >
            {!allowed ? (
              <Lock aria-hidden className="size-4 text-muted-foreground" />
            ) : status.state === "compiled" && !switchedOff ? (
              <CircleCheck aria-hidden className="size-4 text-[#1a9b54]" />
            ) : (
              <CircleAlert
                aria-hidden
                className={cn(
                  "size-4",
                  status.state === "idle" || switchedOff
                    ? "text-muted-foreground"
                    : "text-[#d92d20]",
                )}
              />
            )}
            <div className="flex min-w-0 flex-1 flex-col text-xs">
              {!allowed ? (
                <>
                  <span className="text-[13px] font-semibold">Not run</span>
                  <span className="text-muted-foreground">
                    Allow custom code to compile this shader.
                  </span>
                </>
              ) : switchedOff ? (
                <>
                  <span className="text-[13px] font-semibold">Switched off</span>
                  <span className="text-muted-foreground">
                    Drawing each frame took too long. Simplify the loops or lower the counts, then
                    turn it on again.
                  </span>
                </>
              ) : status.state === "compiled" ? (
                <>
                  <span className="text-[13px] font-semibold text-[#1a7f45]">Works</span>
                  <span className="text-muted-foreground">
                    {`Compiled in ${String(status.ms)} ms · ${
                      role === "effect" ? "changes the picture below" : "draws the background"
                    } · ${
                      status.names.length === 1
                        ? "1 setting"
                        : `${String(status.names.length)} settings`
                    } found${
                      status.problems > 0
                        ? ` · ${String(status.problems)} @param line not understood`
                        : ""
                    }`}
                  </span>
                </>
              ) : status.state === "error" ? (
                <>
                  <span className="text-[13px] font-semibold text-[#b42318]">
                    {status.line
                      ? `Line ${String(status.line)}: ${status.message}`
                      : status.message}
                  </span>
                  <span className="text-muted-foreground">
                    The preview keeps showing the last version that worked.
                  </span>
                </>
              ) : status.state === "too-long" ? (
                <>
                  <span className="text-[13px] font-semibold text-[#b42318]">
                    The code is too long to compile
                  </span>
                  <span className="text-muted-foreground">
                    Shorten it, then try again. Comments and blank lines count too.
                  </span>
                </>
              ) : (
                <span className="text-muted-foreground">Checking the code…</span>
              )}
            </div>
          </div>
        </div>

        <aside
          aria-label="Preview and settings"
          className="flex min-h-0 w-[420px] shrink-0 flex-col gap-5 overflow-y-auto p-4"
        >
          <section aria-label="Preview" className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold">Preview</h2>
            <div className="relative h-[230px] w-[388px] overflow-hidden rounded-lg border border-border bg-muted">
              {allowed ? (
                <canvas
                  ref={preview}
                  data-testid="shader-preview"
                  aria-label="Preview of the shader"
                  className="size-full"
                />
              ) : (
                <div className="flex size-full flex-col items-center justify-center gap-1.5 text-center">
                  <Lock aria-hidden className="size-5" />
                  <span className="text-[13px] font-medium">Custom code is off</span>
                  <span className="text-xs text-muted-foreground">
                    Allow it to see the preview.
                  </span>
                </div>
              )}
              {allowed && switchedOff ? (
                <span className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                  Layer switched off
                </span>
              ) : allowed && status.state === "error" ? (
                <span className="absolute right-2 bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">
                  Last working version
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                aria-label={playing ? "Pause the preview" : "Play the preview"}
                className="flex size-8 items-center justify-center rounded-full bg-brand text-brand-foreground"
                onClick={() => {
                  setPlaying(!playing);
                }}
              >
                {playing ? (
                  <Pause aria-hidden className="size-3.5 fill-current" />
                ) : (
                  <Play aria-hidden className="size-3.5 fill-current" />
                )}
              </button>
              <input
                type="range"
                aria-label="Preview time"
                className="lg-slider flex-1"
                style={
                  {
                    "--lg-fill": `${String((time / studioScene.loop) * 100)}%`,
                  } as React.CSSProperties
                }
                min={0}
                max={studioScene.loop}
                step={0.1}
                value={time}
                onPointerDown={() => {
                  setPlaying(false);
                }}
                onChange={(e) => {
                  setTime(Number(e.target.value));
                }}
              />
              <span className="w-[74px] text-right text-xs text-muted-foreground tabular-nums">
                {`${time.toFixed(1)} / ${studioScene.loop.toFixed(1)} s`}
              </span>
            </div>
          </section>
          <hr className="border-border" />
          <section aria-label="Settings" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-semibold">Settings</h2>
              <span className="font-mono text-[11px] text-muted-foreground">
                made from // @param
              </span>
            </div>
            {!allowed ? (
              <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
                <SlidersHorizontal aria-hidden className="size-4" /> Settings appear after the
                shader runs.
              </p>
            ) : specs.length === 0 ? (
              <p className="rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
                No settings yet. Press Add a setting, or write a // @param line in the code.
              </p>
            ) : (
              specs.map((spec) => (
                <SettingControl
                  key={spec.id}
                  spec={spec}
                  plain
                  value={(resolved[spec.id] ?? spec.default) as ShaderParamValue}
                  onChange={(v) => {
                    setValues((current) => ({ ...current, [spec.id]: v }));
                  }}
                />
              ))
            )}
            <p className="text-[11px] leading-snug font-medium text-muted-foreground">
              These controls come from the // @param lines at the top of your code. Change a line
              and the control follows.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
