import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  CircleAlert,
  CircleCheck,
  Code,
  FileCode2,
  Lock,
  Pause,
  Play,
  Plus,
  Redo2,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  WandSparkles,
  AlignLeft,
  ChevronDown,
  X,
  Copy,
} from "lucide-react";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { cn } from "@/ui/lib/utils";
import { computeLayout } from "@/presentation/compose";
import { drawComposition, drawShaderBackground } from "@/presentation/draw-presentation";
import { addCustom, setCustom } from "@/shader/edit";
import {
  aiBrief,
  checkCustomCode,
  customValues,
  EXAMPLES,
  parsePragmas,
  type Example,
} from "@/shader/custom";
import { sharedRenderer } from "@/shader/renderer";
import type { LayerRole, ShaderLayer, ShaderParamValue, ShaderScene } from "@/shader/types";
import type { BaseImage } from "../base-image";
import { useEditor, useStores, useUi } from "../context";
import { renderPicture } from "../picture";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { useStudio, useStudioStore } from "./context";
import { DiscardDialog } from "./dialogs";
import { MenuItem, MenuLabel, Popover } from "./parts";
import { ReferencePanel } from "./ReferencePanel";
import { SettingControl } from "./SettingControl";
import { SettingsBuilder } from "./SettingsBuilder";
import type { ShaderEditorTarget } from "./studio-store";

type Tab = "code" | "settings" | "reference";

type Status =
  | { state: "idle" }
  | { state: "compiled"; ms: number; names: string[]; problems: number }
  | { state: "error"; line: number | null; message: string }
  | { state: "too-long"; message: string };

const SNIPPETS: { label: string; text: string }[] = [
  { label: "Loop-safe wave", text: "sin(u_phase * 6.28318 * 2.0 + uv.x * 6.0)" },
  { label: "Palette mix", text: "mix(u_palette[0], u_palette[1], uv.y)" },
  {
    label: "Centred coordinates",
    text: "(gl_FragCoord.xy - 0.5 * u_resolution) / min(u_resolution.x, u_resolution.y)",
  },
  { label: "Soft circle", text: "smoothstep(0.5, 0.45, length(uv - 0.5))" },
  { label: "Rotate a point", text: "rot(u_phase * 6.28318) * (uv - 0.5)" },
];

function ToolButton({
  label,
  icon: Icon,
  off,
  onClick,
}: {
  label: string;
  icon: typeof Code;
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

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

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

/**
 * The shader editor (design: Studio / Shader editor): your own GLSL, checked as you type, with a live
 * preview, the settings your @param lines make, examples, a reference and a brief to copy for an AI. It
 * works on a draft; Apply puts the layer in the stack, Cancel drops the draft.
 */
export function ShaderEditor({
  target,
  base,
  onClose,
}: {
  target: ShaderEditorTarget;
  base: BaseImage;
  onClose: () => void;
}) {
  const store = useStudioStore();
  const { session, ui } = useStores();
  const project = useEditor((s) => s.project);
  const studioScene = useStudio((s) => s.scene);
  const heavy = useStudio((s) => s.heavy);
  const existing: ShaderLayer | undefined =
    target.kind === "layer" ? studioScene.layers.find((l) => l.id === target.id) : undefined;

  const initial = useMemo(() => {
    if (target.kind === "new") {
      return {
        name: target.name,
        role: target.role,
        code: target.code,
        values: {},
      };
    }
    return {
      name: existing?.name ?? "Shader",
      role: existing?.role ?? "generator",
      code: existing?.code ?? "",
      values: { ...(existing?.params ?? {}) },
    };
    // The draft starts from the layer as it is when the editor opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [name, setName] = useState(initial.name);
  const [role, setRole] = useState<LayerRole>(initial.role);
  const [code, setCode] = useState(initial.code);
  const [values, setValues] = useState(initial.values);
  const [tab, setTab] = useState<Tab>("code");
  const [view, setView] = useState<"background" | "screenshot" | "result" | "input">(
    initial.role === "effect" ? "result" : "background",
  );
  const [live, setLive] = useState(true);
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [aiOpen, setAiOpen] = useState(false);
  const [aiCode, setAiCode] = useState(true);
  const [aiExample, setAiExample] = useState(true);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<"examples" | "insert" | null>(null);
  const [find, setFind] = useState<string | null>(null);
  const [discard, setDiscard] = useState(false);
  const [time, setTime] = useState(studioScene.poster);
  const [playing, setPlaying] = useState(true);
  const [hist, setHist] = useState({ undo: false, redo: false });
  const editorRef = useRef<CodeEditorHandle>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const lastMs = useRef(0);
  const frames = useRef(0);

  // Code from a file that came from outside is read-only and does not run until the user allows it.
  const layerLike = { ...(existing ?? {}), code } as ShaderLayer;
  const documentAllowed = useUi((s) => s.codeAllowed);
  const allowed = target.kind === "new" || documentAllowed || session.canRun(layerLike);
  const switchedOff = existing !== undefined && heavy.includes(existing.id);

  const params = useMemo(() => parsePragmas(code), [code]);
  const specs = params.params.map((p) => p.spec);
  const resolved = useMemo(() => customValues(specs, values), [specs, values]);

  // Compile as you type (or when asked), and say what happened.
  const [runTick, setRunTick] = useState(0);
  useEffect(() => {
    if (!allowed) return;
    const run = () => {
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
    };
    if (!live && runTick === 0) {
      run();
      return;
    }
    if (!live) return;
    const timer = setTimeout(run, 250);
    return () => {
      clearTimeout(timer);
    };
  }, [code, live, runTick, allowed]);

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

  // What the preview shows: this layer alone, or on what is below it.
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
  const previewScene = useMemo((): ShaderScene => {
    const layers = view === "input" ? below : [...below, draft];
    return { ...studioScene, layers };
  }, [studioScene, below, draft, view]);

  const picture = useMemo(
    () => project.crop ?? { x: 0, y: 0, width: base.width, height: base.height },
    [project.crop, base.width, base.height],
  );
  const content = useMemo(
    () => renderPicture(base, project.layers, project.crop),
    [base, project.layers, project.crop],
  );

  const draw = useCallback(() => {
    const el = preview.current;
    if (!el || !allowed) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(408 * dpr);
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
    const trusted = true;
    if (view === "screenshot") {
      const presentation = { ...project.presentation, enabled: true, background: previewScene };
      const layout = computeLayout(picture, presentation);
      const scale = Math.min(w / layout.canvas.width, h / layout.canvas.height);
      ctx.translate((w - layout.canvas.width * scale) / 2, (h - layout.canvas.height * scale) / 2);
      drawComposition(
        ctx,
        { content, presentation, shaderSeconds: time, trustCustomCode: trusted },
        layout,
        scale,
      );
    } else {
      const measure = frames.current % 20 === 0;
      const report = drawShaderBackground(ctx, previewScene, w, h, 1, {
        seconds: time,
        trustCustomCode: trusted,
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
    }
  }, [allowed, view, previewScene, project.presentation, picture, content, time, existing, store]);
  useEffect(() => {
    draw();
  }, [draw]);

  const doUndo = () => {
    editorRef.current?.undo();
  };
  const doRedo = () => {
    editorRef.current?.redo();
  };
  const doTidy = () => {
    editorRef.current?.tidy();
  };
  const toggleFind = () => {
    setFind((f) => (f === null ? "" : null));
  };

  const dirty =
    name !== initial.name ||
    role !== initial.role ||
    code !== initial.code ||
    JSON.stringify(values) !== JSON.stringify(initial.values);
  const compiledOk = status.state === "compiled";
  const canApply = allowed && compiledOk && !switchedOff && name.trim() !== "";

  const apply = () => {
    if (!canApply) return;
    const params = { ...values, ...resolved } as ShaderLayer["params"];
    if (target.kind === "new") {
      const made = addCustom(store.getState().scene, role, name.trim(), code, params);
      if (!made) {
        store.getState().setNotice("The stack is full. Remove a layer first.");
        onClose();
        return;
      }
      session.noteOwnCode(code);
      store.getState().change(() => made.scene);
      store.getState().select(made.id);
    } else if (existing) {
      session.noteOwnCode(code);
      store
        .getState()
        .change((s) => setCustom(s, existing.id, { name: name.trim(), role, code, params }));
    }
    onClose();
  };
  const cancel = () => {
    if (dirty) setDiscard(true);
    else onClose();
  };

  // Keys of the editor: Esc leaves it, the Studio's own keys stay out of it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (discard) return;
      if (e.key === "Escape" && menu === null && !aiOpen && find === null) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        setRunTick((n) => n + 1);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setFind((f) => f ?? "");
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
    setRole(example.role);
    setView(example.role === "effect" ? "result" : "background");
    if (name === "Untitled shader" || EXAMPLES.some((e) => e.name === name)) setName(example.name);
    setValues({});
    setTab("code");
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };
  const brief = aiBrief({
    ...(aiCode ? { code } : {}),
    ...(aiExample
      ? { example: (EXAMPLES.find((e) => e.role === role) ?? EXAMPLES[0])?.code ?? "" }
      : {}),
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
        ? { label: "Compiled", tone: "bg-[#e7f7ec] text-[#1a7f45]", dot: "bg-[#1a9b54]" }
        : status.state === "error"
          ? { label: "Error", tone: "bg-[#fdeaea] text-[#b42318]", dot: "bg-[#d92d20]" }
          : status.state === "too-long"
            ? { label: "Too long", tone: "bg-[#fdeaea] text-[#b42318]", dot: "bg-[#d92d20]" }
            : {
                label: "Checking",
                tone: "bg-muted text-muted-foreground",
                dot: "bg-muted-foreground",
              };

  const tabs: { id: Tab; label: string; icon: typeof Code }[] = [
    { id: "code", label: "fragment.glsl", icon: FileCode2 },
    { id: "settings", label: "Settings", icon: SlidersHorizontal },
    { id: "reference", label: "Reference", icon: BookOpen },
  ];

  const inputsList =
    role === "effect"
      ? [
          ["u_input", "the layers below, as a picture"],
          ["u_phase", "0 to 1, repeats every loop"],
          ["u_resolution", "size of the background in pixels"],
          ["u_seed", "from the Seed field"],
        ]
      : [
          ["u_palette", `${String(studioScene.palette.length)} colours from the Studio palette`],
          ["u_phase", "0 to 1, repeats every loop"],
          ["u_resolution", "size of the background in pixels"],
          ["u_seed", "from the Seed field"],
        ];

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
          aria-label="Back to the Studio"
          className="flex size-8 items-center justify-center rounded-md hover:bg-muted"
          onClick={cancel}
        >
          <ArrowLeft aria-hidden className="size-4" />
        </button>
        <h1 className="text-sm font-semibold">Shader editor</h1>
        <span className="h-5 w-px bg-border" aria-hidden />
        <label className="flex h-9 w-[180px] items-center gap-2 rounded-lg bg-muted px-3 text-[13px] focus-within:ring-2 focus-within:ring-ring">
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
        <div
          role="radiogroup"
          aria-label="Kind of shader"
          className="flex gap-0.5 rounded-lg bg-muted p-0.5"
        >
          {(
            [
              ["generator", "Generator", Sparkles],
              ["effect", "Effect", WandSparkles],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={role === id}
              disabled={!allowed}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px]",
                role === id
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                setRole(id);
                setView(id === "effect" ? "result" : "background");
              }}
            >
              <Icon aria-hidden className="size-3.5" /> {label}
            </button>
          ))}
        </div>
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
            className="top-full right-0 mt-1 max-h-[600px] w-[320px] overflow-y-auto"
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
        <Button
          variant="outline"
          className="h-9 gap-1.5 text-[13px]"
          onClick={() => {
            setAiOpen(true);
          }}
        >
          <Sparkles aria-hidden className="size-3.5" /> Copy for AI
        </Button>
        <Button variant="outline" className="h-9 text-[13px]" onClick={cancel}>
          Cancel
        </Button>
        <button
          type="button"
          disabled={!canApply}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-[13px] font-medium text-brand-foreground hover:opacity-90 disabled:opacity-40"
          onClick={apply}
        >
          <Check aria-hidden className="size-3.5" /> Apply
        </button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border">
          <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
            <div role="tablist" aria-label="Editor tabs" className="flex gap-1">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={cn(
                    "relative flex h-12 items-center gap-1.5 px-3 text-[13px]",
                    t.id === "code" && "font-mono",
                    tab === t.id
                      ? "font-medium text-foreground after:absolute after:right-2 after:bottom-0 after:left-2 after:h-0.5 after:rounded-full after:bg-brand"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => {
                    setTab(t.id);
                  }}
                >
                  <t.icon aria-hidden className="size-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
            {!allowed ? (
              <span className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
                <Lock aria-hidden className="size-3" /> Read-only
              </span>
            ) : null}
            <span className="flex-1" />
            {find !== null ? (
              <label className="flex h-8 items-center gap-1.5 rounded-md bg-muted px-2 text-xs">
                <Search aria-hidden className="size-3.5" />
                <input
                  autoFocus
                  aria-label="Find in the code"
                  value={find}
                  className="w-32 bg-transparent outline-none"
                  onChange={(e) => {
                    setFind(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") editorRef.current?.find(find);
                    if (e.key === "Escape") {
                      setFind(null);
                      editorRef.current?.focus();
                    }
                  }}
                />
              </label>
            ) : null}
            <ToolButton
              label="Undo"
              icon={Undo2}
              off={!hist.undo || tab !== "code"}
              onClick={doUndo}
            />
            <ToolButton
              label="Redo"
              icon={Redo2}
              off={!hist.redo || tab !== "code"}
              onClick={doRedo}
            />
            <ToolButton label="Find" icon={Search} off={tab !== "code"} onClick={toggleFind} />
            <ToolButton
              label="Tidy the code"
              icon={AlignLeft}
              off={!allowed || tab !== "code"}
              onClick={doTidy}
            />
            <div className="relative">
              <Button
                variant="outline"
                className="h-8 gap-1 px-2.5 text-[13px]"
                aria-haspopup="menu"
                aria-expanded={menu === "insert"}
                disabled={!allowed}
                onClick={() => {
                  setMenu(menu === "insert" ? null : "insert");
                }}
              >
                <Plus aria-hidden className="size-3.5" /> Insert{" "}
                <ChevronDown aria-hidden className="size-3" />
              </Button>
              <Popover
                open={menu === "insert"}
                onClose={() => {
                  setMenu(null);
                }}
                className="top-full right-0 mt-1 w-[300px]"
              >
                <div role="menu" aria-label="Insert">
                  <MenuLabel>Inside your code</MenuLabel>
                  {SNIPPETS.map((s) => (
                    <MenuItem
                      key={s.label}
                      label={s.label}
                      onClick={() => {
                        setMenu(null);
                        setTab("code");
                        requestAnimationFrame(() => editorRef.current?.insert(s.text));
                      }}
                    />
                  ))}
                </div>
              </Popover>
            </div>
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

          {tab === "code" ? (
            <CodeEditor
              ref={editorRef}
              value={code}
              readOnly={!allowed}
              errorLine={errorLine}
              onChange={setCode}
              onCursor={setCursor}
              onHistory={() => {
                setHist({
                  undo: editorRef.current?.canUndo() ?? false,
                  redo: editorRef.current?.canRedo() ?? false,
                });
              }}
            />
          ) : null}
          {tab === "settings" ? (
            <SettingsBuilder code={code} values={resolved} readOnly={!allowed} onCode={setCode} />
          ) : null}
          {tab === "reference" ? (
            <ReferencePanel
              role={role}
              onInsert={(text) => {
                setTab("code");
                requestAnimationFrame(() => editorRef.current?.insert(text));
              }}
              onInsertUniform={(line) => {
                setTab("code");
                requestAnimationFrame(() =>
                  editorRef.current?.insertAfterLast(/^\s*uniform\b/, line),
                );
              }}
              onCopy={(text) => {
                void copy(text);
              }}
            />
          ) : null}

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
                  <span className="text-[13px] font-semibold text-[#1a7f45]">Compiled</span>
                  <span className="text-muted-foreground">
                    {`${String(status.ms)} ms · ${
                      status.names.length === 1
                        ? "1 parameter"
                        : `${String(status.names.length)} parameters`
                    } found${status.names.length > 0 ? `: ${status.names.join(", ")}` : ""}${
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
                    The preview keeps showing the last working version.
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
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Run while I type
              <Switch
                aria-label="Run while I type"
                checked={live}
                onCheckedChange={(on) => {
                  setLive(on);
                  if (on) setRunTick((n) => n + 1);
                }}
              />
            </label>
            {!live ? (
              <Button
                variant="outline"
                className="h-8 text-[13px]"
                onClick={() => {
                  setRunTick((n) => n + 1);
                }}
              >
                Run
              </Button>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-4 border-t border-border px-5 py-2 text-xs text-muted-foreground">
            <span data-testid="cursor">
              {allowed ? `Ln ${String(cursor.line)}, Col ${String(cursor.column)}` : "Read-only"}
            </span>
            <span>GLSL ES 1.00 · WebGL 1</span>
            <span className="flex-1" />
            <span
              className={cn(status.state === "too-long" && "text-[#b42318]")}
              data-testid="code-size"
            >
              {status.state === "too-long" ? "Too long" : kb(new Blob([code]).size)}
            </span>
          </div>
        </div>

        <aside
          aria-label="Preview and settings"
          className="flex min-h-0 w-[420px] shrink-0 flex-col gap-5 overflow-y-auto p-4"
        >
          <section aria-label="Preview" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold">Preview</h2>
              <div
                role="radiogroup"
                aria-label="Preview content"
                className="flex gap-0.5 rounded-lg bg-muted p-0.5 text-xs"
              >
                {(role === "effect"
                  ? ([
                      ["result", "Result"],
                      ["input", "Input"],
                    ] as const)
                  : ([
                      ["background", "Background only"],
                      ["screenshot", "With screenshot"],
                    ] as const)
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={view === id}
                    className={cn(
                      "h-7 rounded-md px-2.5",
                      view === id
                        ? "bg-background font-medium shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => {
                      setView(id);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
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
          <section
            aria-label={tab === "settings" ? "How your settings look" : "Parameters"}
            className="flex flex-col gap-3"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-semibold">
                {tab === "settings" ? "How your settings look" : "Parameters"}
              </h2>
              <span className="font-mono text-[11px] text-muted-foreground">from // @param</span>
            </div>
            {!allowed ? (
              <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
                <SlidersHorizontal aria-hidden className="size-4" /> Settings appear after the
                shader runs.
              </p>
            ) : specs.length === 0 ? (
              <p className="rounded-lg bg-muted px-3 py-2.5 text-[13px] text-muted-foreground">
                No settings yet. Write a // @param line in the code, or add one in the Settings tab.
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
          </section>
          <hr className="border-border" />
          <section aria-label="Inputs your shader receives" className="flex flex-col gap-2.5">
            <h2 className="text-[13px] font-semibold">Inputs your shader receives</h2>
            <dl className="flex flex-col gap-1.5 text-xs">
              {inputsList.map(([n, text]) => (
                <div key={n} className="grid grid-cols-[110px_1fr] gap-3">
                  <dt className="font-mono">{n}</dt>
                  <dd className="text-muted-foreground">{text}</dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>

        {aiOpen ? (
          <div
            role="dialog"
            aria-label="Ask an AI to write your shader"
            className="absolute top-0 right-0 bottom-0 z-20 flex w-[480px] flex-col gap-4 overflow-y-auto border-l border-border bg-card p-5 shadow-[-8px_0_24px_rgb(0_0_0/0.1)]"
          >
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-full bg-brand/40">
                <Sparkles aria-hidden className="size-4" />
              </span>
              <h2 className="flex-1 text-[15px] font-semibold">Ask an AI to write your shader</h2>
              <button
                type="button"
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-md hover:bg-muted"
                onClick={() => {
                  setAiOpen(false);
                }}
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
            <p className="text-[13px] text-muted-foreground">
              LumenGrab has no built-in AI and sends nothing anywhere. You copy a brief, paste it
              into the AI you already use, and paste its answer back into the editor.
            </p>
            <ol className="flex flex-col gap-3 text-[13px]">
              {[
                "Copy the brief below.",
                "Paste it into your AI and describe your effect where it says MY REQUEST.",
                "Paste the code you get back into fragment.glsl.",
              ].map((step, i) => (
                <li key={step} className="flex items-start gap-3">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                      i === 0 ? "bg-brand" : "bg-muted",
                    )}
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <hr className="border-border" />
            {(
              [
                [
                  "Include my current code",
                  "The AI can improve what you already have.",
                  aiCode,
                  setAiCode,
                ],
                [
                  "Include a working example",
                  "Helps the AI follow the rules.",
                  aiExample,
                  setAiExample,
                ],
              ] as const
            ).map(([label, hint, on, set]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <div className="flex flex-col">
                  <span className="text-[13px] font-medium">{label}</span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </div>
                <Switch aria-label={label} checked={on} onCheckedChange={set} />
              </div>
            ))}
            <div className="flex items-baseline justify-between text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              <h3>The brief</h3>
              <span className="font-normal normal-case">Plain text, ready to paste</span>
            </div>
            <pre
              data-testid="ai-brief"
              className="max-h-[260px] min-h-[160px] overflow-auto rounded-lg border border-border bg-muted/50 p-3 font-mono text-xs leading-5 whitespace-pre-wrap"
            >
              {brief}
            </pre>
            <button
              type="button"
              className="flex h-11 items-center justify-center gap-2 rounded-lg bg-brand text-[13px] font-medium text-brand-foreground hover:opacity-90"
              onClick={() => {
                void copy(brief).then((ok) => {
                  setCopied(ok);
                  if (ok) {
                    ui.getState().pushToast({
                      icon: "saved",
                      text: "Brief copied. Paste it into your AI.",
                    });
                    setTimeout(() => {
                      setCopied(false);
                    }, 2500);
                  }
                });
              }}
            >
              {copied ? (
                <Check aria-hidden className="size-4" />
              ) : (
                <Copy aria-hidden className="size-4" />
              )}
              {copied ? "Copied" : "Copy brief"}
            </button>
            <p className="text-xs text-muted-foreground">
              Read code from any source before you run it. Files from other people ask for
              permission before custom code runs.
            </p>
          </div>
        ) : null}
      </div>
      {discard ? (
        <DiscardDialog
          name={name}
          onKeep={() => {
            setDiscard(false);
          }}
          onDiscard={onClose}
        />
      ) : null}
    </div>
  );
}
