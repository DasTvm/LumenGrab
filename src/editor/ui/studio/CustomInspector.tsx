import { useMemo, useState } from "react";
import { Code, Lock, TriangleAlert, CircleCheck } from "lucide-react";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import { patchLayer, setParam } from "@/shader/edit";
import { checkCustomCode, customValues, parsePragmas } from "@/shader/custom";
import { sharedRenderer } from "@/shader/renderer";
import {
  BLEND_MODES,
  type BlendMode,
  type ShaderLayer,
  type ShaderParamValue,
} from "@/shader/types";
import { useStores, useUi } from "../context";
import { Slider } from "../controls";
import { useStudio, useStudioStore } from "./context";
import { DecimalBox } from "./parts";
import { SettingControl } from "./SettingControl";

type Compile =
  | { kind: "off" }
  | { kind: "none" }
  | { kind: "long" }
  | { kind: "ok"; ms: number }
  | { kind: "error"; line: number | null; message: string };

const shown = (v: number | boolean | string | undefined): string =>
  typeof v === "boolean" ? (v ? "On" : "Off") : v === undefined ? "" : String(v);

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

/** The settings of a layer with your own code: the Settings and Code tabs (design: Studio / Custom shader). */
export function CustomInspector({ layer }: { layer: ShaderLayer }) {
  const store = useStudioStore();
  const { session } = useStores();
  const documentAllowed = useUi((s) => s.codeAllowed);
  const heavy = useStudio((s) => s.heavy.includes(layer.id));
  const [tab, setTab] = useState<"settings" | "code">("settings");
  const code = layer.code ?? "";
  const allowed = documentAllowed || session.canRun(layer);
  const parsed = useMemo(() => parsePragmas(code), [code]);
  const specs = parsed.params.map((p) => p.spec);
  const values = customValues(specs, layer.params);

  const compile = useMemo((): Compile => {
    if (!allowed) return { kind: "off" };
    const check = checkCustomCode(code);
    if (!check.ok && check.kind === "too-long") return { kind: "long" };
    const result = sharedRenderer("shader-editor")?.tryCompile(code);
    if (!result) return { kind: "none" };
    return result.ok
      ? { kind: "ok", ms: result.ms }
      : { kind: "error", line: result.line, message: result.message };
  }, [code, allowed]);

  const open = () => {
    store.getState().openEditor({ kind: "layer", id: layer.id });
  };

  // The settings by section, in the order the code lists them.
  const groups: string[] = [];
  for (const spec of specs) if (!groups.includes(spec.group)) groups.push(spec.group);

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label="Custom shader"
        className="flex gap-0.5 rounded-lg bg-muted p-0.5"
      >
        {(
          [
            ["settings", "Settings"],
            ["code", "Code"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn(
              "h-8 flex-1 rounded-md text-[13px]",
              tab === id
                ? "bg-background font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              setTab(id);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {!allowed ? (
        <div className="flex flex-col gap-3 rounded-lg bg-muted p-3">
          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Lock aria-hidden className="size-4" /> This file contains custom shader code
            </span>
            <span className="text-xs text-muted-foreground">
              It runs only if you allow it. Read the code first if you are not sure where the file
              comes from.
            </span>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="h-8 rounded-lg bg-brand px-3 text-[13px] font-medium text-brand-foreground hover:opacity-90"
              onClick={() => {
                void session.allowCode();
              }}
            >
              Run custom code
            </button>
            <Button variant="outline" className="h-8 text-[13px]">
              Keep off
            </Button>
          </div>
        </div>
      ) : heavy ? (
        <div className="flex flex-col gap-2 rounded-lg bg-[#fff4e5] p-3">
          <span className="flex items-center gap-1.5 text-[13px] font-semibold">
            <TriangleAlert aria-hidden className="size-4 text-[#b54708]" /> This shader is too heavy
            and was switched off
          </span>
          <span className="text-xs text-muted-foreground">
            It slowed the preview down too much.
          </span>
          <Button
            variant="outline"
            className="h-8 w-fit text-[13px]"
            onClick={() => {
              store.getState().clearHeavy(layer.id);
              store.getState().change((s) => patchLayer(s, layer.id, { enabled: true }));
            }}
          >
            Turn on again
          </Button>
        </div>
      ) : null}

      {tab === "settings" ? (
        <>
          <section
            aria-label="Shader settings"
            className="flex flex-col gap-3 border-b border-border pb-4"
          >
            <div className="flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold">Shader settings</h3>
              <span className="text-xs text-muted-foreground">made by you</span>
            </div>
            {!allowed ? (
              <p className="text-[13px] text-muted-foreground">
                Settings appear after the shader runs.
              </p>
            ) : specs.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">
                This shader has no settings. Add a // @param line in the code editor.
              </p>
            ) : (
              groups.map((group) => (
                <div key={group} className="flex flex-col gap-3">
                  {groups.length > 1 || group !== "Settings" ? (
                    <h4 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                      {group}
                    </h4>
                  ) : null}
                  {specs
                    .filter((s) => s.group === group)
                    .map((spec) => (
                      <SettingControl
                        key={spec.id}
                        spec={spec}
                        value={(values[spec.id] ?? spec.default) as ShaderParamValue}
                        onStart={() => {
                          store.getState().begin();
                        }}
                        onEnd={() => {
                          store.getState().end();
                        }}
                        onChange={(v) => {
                          store.getState().change((s) => setParam(s, layer.id, spec.id, v));
                        }}
                      />
                    ))}
                </div>
              ))
            )}
          </section>
          <section
            aria-label="Advanced"
            className="flex flex-col gap-3 border-b border-border pb-4"
          >
            <h3 className="text-[13px] font-semibold">Advanced</h3>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">Opacity</span>
                <DecimalBox
                  label="Opacity"
                  value={layer.opacity}
                  min={0}
                  max={1}
                  step={0.05}
                  decimals={0}
                  scale={100}
                  unit="%"
                  className="w-[64px]"
                  onChange={(opacity) => {
                    store.getState().change((s) => patchLayer(s, layer.id, { opacity }));
                  }}
                />
              </div>
              <Slider
                label="Opacity slider"
                value={Math.round(layer.opacity * 100)}
                min={0}
                max={100}
                onStart={() => {
                  store.getState().begin();
                }}
                onEnd={() => {
                  store.getState().end();
                }}
                onChange={(v) => {
                  store.getState().change((s) => patchLayer(s, layer.id, { opacity: v / 100 }));
                }}
              />
            </div>
            <label className="flex items-center justify-between text-[13px]">
              <span className="text-muted-foreground">Blend</span>
              <select
                aria-label="Blend"
                value={layer.blend}
                className="h-8 w-[150px] rounded-md bg-muted px-3 text-[13px]"
                onChange={(e) => {
                  store
                    .getState()
                    .change((s) => patchLayer(s, layer.id, { blend: e.target.value as BlendMode }));
                }}
              >
                {BLEND_MODES.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </label>
          </section>
          <div className="flex flex-col gap-2">
            <Button variant="outline" className="h-9 gap-1.5 text-[13px]" onClick={open}>
              <Code aria-hidden className="size-3.5" /> Edit in shader editor
            </Button>
          </div>
        </>
      ) : (
        <section aria-label="Code" className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2.5">
            <Code aria-hidden className="size-4 text-muted-foreground" />
            <span className="font-mono text-[13px]">fragment.glsl</span>
            <span
              className={cn(
                "text-xs",
                code.length > 16384 ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {code.length > 16384 ? "Too long" : kb(new Blob([code]).size)}
            </span>
            <span className="flex-1" />
            <Button variant="outline" className="h-8 text-[13px]" onClick={open}>
              Open editor
            </Button>
          </div>
          <div
            role="status"
            className={cn(
              "flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs",
              !allowed || heavy
                ? "bg-muted"
                : compile.kind === "long" || compile.kind === "error"
                  ? "bg-[#fdf0ef]"
                  : "bg-[#effaf3]",
            )}
          >
            {!allowed ? (
              <>
                <Lock aria-hidden className="mt-0.5 size-4" />
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold">Not run</span>
                  <span className="text-muted-foreground">
                    Allow custom code to compile this shader.
                  </span>
                </div>
              </>
            ) : heavy ? (
              <>
                <TriangleAlert aria-hidden className="mt-0.5 size-4" />
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold">Switched off</span>
                  <span className="text-muted-foreground">
                    Drawing each frame took too long. Simplify the loops or lower the counts.
                  </span>
                </div>
              </>
            ) : compile.kind === "long" ? (
              <>
                <TriangleAlert aria-hidden className="mt-0.5 size-4 text-[#d92d20]" />
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold">The code is too long to compile</span>
                  <span className="text-muted-foreground">
                    Shorten it, then try again. Comments and blank lines count too.
                  </span>
                </div>
              </>
            ) : compile.kind === "ok" ? (
              <>
                <CircleCheck aria-hidden className="mt-0.5 size-4 text-[#1a9b54]" />
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold text-[#1a7f45]">Compiled</span>
                  <span className="text-muted-foreground">
                    {`${String(Math.max(1, Math.round(compile.ms)))} ms · ${String(specs.length)} ${specs.length === 1 ? "parameter" : "parameters"} found`}
                  </span>
                </div>
              </>
            ) : compile.kind === "error" ? (
              <>
                <TriangleAlert aria-hidden className="mt-0.5 size-4 text-[#d92d20]" />
                <div className="flex flex-col">
                  <span className="text-[13px] font-semibold text-[#b42318]">
                    {compile.line
                      ? `Line ${String(compile.line)}: ${compile.message}`
                      : compile.message}
                  </span>
                  <span className="text-muted-foreground">
                    The last working version keeps running.
                  </span>
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">
                WebGL is not available, so the code cannot be checked.
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between">
              <h3 className="text-[13px] font-semibold">Parameters</h3>
              <span className="font-mono text-[11px] text-muted-foreground">from // @param</span>
            </div>
            {specs.length === 0 ? (
              <p className="text-xs text-muted-foreground">No @param lines in the code.</p>
            ) : (
              specs.map((spec) => (
                <div key={spec.id} className="flex items-center justify-between text-[13px]">
                  <span className="font-mono text-muted-foreground">{spec.id}</span>
                  <span className="tabular-nums">{shown(values[spec.id])}</span>
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}
