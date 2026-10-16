import { useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronDown,
  Dices,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { cn } from "@/ui/lib/utils";
import { Switch } from "@/ui/components/switch";
import { patchLayer, removeLayer, resetParams, setParam } from "@/shader/edit";
import { kindById, kindDefaults, type KindDef } from "@/shader/kinds";
import { normalizeStops, readParam, type NumberSpec, type ParamSpec } from "@/shader/params";
import { layerColors, layerLabel, paletteUse } from "@/shader/scene";
import {
  BLEND_MODES,
  DIRECTIONS,
  type BlendMode,
  type Direction,
  type GradientStop,
  type LayerPatch,
  type ShaderLayer,
  type ShaderParamValue,
} from "@/shader/types";
import { Pills, Slider } from "../controls";
import { ColorChip, HexInput } from "../presentation/fields";
import { useStudio, useStudioStore } from "./context";
import { DecimalBox, KindChip, MenuItem, MiniStepper, Popover } from "./parts";
import { CustomInspector } from "./CustomInspector";
import { duplicate, remove } from "./StackPanel";

type Store = ReturnType<typeof useStudioStore>;

const ARROWS: Record<Direction, typeof ArrowRight> = {
  right: ArrowRight,
  left: ArrowLeft,
  up: ArrowUp,
  down: ArrowDown,
};

function Reset({ label, show, onClick }: { label: string; show: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={!show}
      className={cn(
        "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground",
        !show && "opacity-30",
      )}
      onClick={onClick}
    >
      <RotateCcw aria-hidden className="size-3" />
    </button>
  );
}

function Section({
  title,
  onReset,
  canReset,
  children,
}: {
  title: string;
  onReset?: () => void;
  canReset?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 border-b border-border py-4 first:pt-0"
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-expanded={open}
          className="flex items-center gap-1.5 text-[13px] font-semibold"
          onClick={() => {
            setOpen(!open);
          }}
        >
          <ChevronDown
            aria-hidden
            className={cn("size-3.5 transition-transform", !open && "-rotate-90")}
          />
          {title}
        </button>
        {onReset ? (
          <Reset label={`Reset ${title}`} show={canReset ?? true} onClick={onReset} />
        ) : null}
      </div>
      {open ? <div className="flex flex-col gap-3">{children}</div> : null}
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px]">
      <div className="flex min-w-0 flex-col">
        <span className="text-muted-foreground">{label}</span>
        {hint ? <span className="text-[11px] text-muted-foreground">{hint}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A number with its box, reset and slider. */
function NumberRow({ spec, layer, store }: { spec: NumberSpec; layer: ShaderLayer; store: Store }) {
  const value = readParam(spec, layer.params[spec.id]) as number;
  const percent = spec.unit === "%";
  const decimals = spec.type === "int" ? 0 : (spec.decimals ?? (percent ? 0 : 2));
  const set = (v: number) => {
    store.getState().change((s) => setParam(s, layer.id, spec.id, v));
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-[13px]">
        <span className="text-muted-foreground">{spec.label}</span>
        <span className="flex items-center gap-1">
          <DecimalBox
            label={spec.label}
            value={value}
            min={spec.min}
            max={spec.max}
            step={spec.step}
            decimals={decimals}
            scale={percent ? 100 : 1}
            {...(spec.unit ? { unit: spec.unit } : {})}
            {...(spec.signed ? { signed: true } : {})}
            className="w-[64px]"
            onChange={set}
          />
          <Reset
            label={`Reset ${spec.label}`}
            show={value !== spec.default}
            onClick={() => {
              set(spec.default);
            }}
          />
        </span>
      </div>
      <Slider
        label={`${spec.label} slider`}
        value={value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        onStart={() => {
          store.getState().begin();
        }}
        onEnd={() => {
          store.getState().end();
        }}
        onChange={set}
      />
    </div>
  );
}

const PAIR_LABEL: Record<string, string> = {
  offset: "Offset",
  center: "Centre",
  origin: "Origin",
};

function PairRow({
  base,
  x,
  y,
  layer,
  store,
}: {
  base: string;
  x: NumberSpec;
  y: NumberSpec;
  layer: ShaderLayer;
  store: Store;
}) {
  const box = (spec: NumberSpec, name: string) => {
    const value = readParam(spec, layer.params[spec.id]) as number;
    return (
      <DecimalBox
        label={`${PAIR_LABEL[base] ?? base} ${name}`}
        value={value}
        min={spec.min}
        max={spec.max}
        step={spec.step}
        decimals={2}
        prefix={name}
        className="w-[72px]"
        onChange={(v) => {
          store.getState().change((s) => setParam(s, layer.id, spec.id, v));
        }}
      />
    );
  };
  return (
    <Row label={PAIR_LABEL[base] ?? base}>
      {box(x, "X")}
      {box(y, "Y")}
    </Row>
  );
}

function StopsEditor({
  layer,
  spec,
  store,
}: {
  layer: ShaderLayer;
  spec: Extract<ParamSpec, { type: "stops" }>;
  store: Store;
}) {
  const stops = normalizeStops(layer.params[spec.id], spec.default);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, stops.length - 1);
  const current = stops[index];
  const set = (next: GradientStop[]) => {
    store
      .getState()
      .change((s) => setParam(s, layer.id, spec.id, next as unknown as ShaderParamValue));
  };
  const css = `linear-gradient(90deg, ${stops.map((s) => `${s.color.slice(0, 7)} ${String(s.offset * 100)}%`).join(", ")})`;
  const edit = (recipe: (list: GradientStop[]) => void) => {
    const list = stops.map((s) => ({ ...s }));
    recipe(list);
    set(list.sort((a, b) => a.offset - b.offset));
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div
        data-testid="stop-bar"
        className="h-9 cursor-copy rounded-lg border border-black/10"
        style={{ background: css }}
        title="Click to add a colour"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const offset = Math.round(((e.clientX - r.left) / r.width) * 100) / 100;
          if (stops.length >= 8) return;
          const next = [...stops, { offset, color: current?.color ?? "#808080" }].sort(
            (a, b) => a.offset - b.offset,
          );
          set(next);
          setSelected(next.findIndex((s) => s.offset === offset));
        }}
      />
      <div className="relative mx-2 h-5">
        {stops.map((stop, i) => (
          <button
            key={i}
            type="button"
            role="slider"
            aria-label={`Colour stop ${String(i + 1)}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(stop.offset * 100)}
            className={cn(
              "absolute top-0 size-[18px] -translate-x-1/2 touch-none rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.25)]",
              i === index && "ring-2 ring-primary ring-offset-1 ring-offset-card",
            )}
            style={{ left: `${String(stop.offset * 100)}%`, background: stop.color.slice(0, 7) }}
            onPointerDown={(e) => {
              e.stopPropagation();
              e.currentTarget.setPointerCapture(e.pointerId);
              setSelected(i);
              store.getState().begin();
            }}
            onPointerMove={(e) => {
              if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
              const r = e.currentTarget.parentElement?.getBoundingClientRect();
              if (!r) return;
              const offset = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
              edit((list) => {
                const target = list[i];
                if (target) target.offset = Math.round(offset * 100) / 100;
              });
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              store.getState().end();
            }}
            onClick={(e) => {
              e.stopPropagation();
            }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
              e.preventDefault();
              const step = e.shiftKey ? 0.1 : 0.01;
              edit((list) => {
                const target = list[i];
                if (target)
                  target.offset = Math.min(
                    1,
                    Math.max(
                      0,
                      Math.round((target.offset + (e.key === "ArrowLeft" ? -step : step)) * 100) /
                        100,
                    ),
                  );
              });
            }}
          />
        ))}
      </div>
      {current ? (
        <div className="flex items-center gap-1.5">
          <ColorChip
            label="Colour of the stop"
            value={current.color}
            size="size-8"
            onChange={(hex) => {
              edit((list) => {
                const target = list[index];
                if (target) target.color = hex;
              });
            }}
            onStart={() => {
              store.getState().begin();
            }}
            onEnd={() => {
              store.getState().end();
            }}
          />
          <HexInput
            label="Hex"
            value={current.color}
            className="h-8 min-w-0 flex-1"
            onChange={(hex) => {
              edit((list) => {
                const target = list[index];
                if (target) target.color = hex;
              });
            }}
          />
          <DecimalBox
            label="Stop position"
            value={current.offset}
            min={0}
            max={1}
            step={0.01}
            decimals={0}
            scale={100}
            unit="%"
            className="h-8 w-[64px]"
            onChange={(offset) => {
              edit((list) => {
                const target = list[index];
                if (target) target.offset = offset;
              });
            }}
          />
          <button
            type="button"
            aria-label="Add a colour"
            disabled={stops.length >= 8}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
            onClick={() => {
              const next = stops[index + 1] ?? stops[index - 1];
              const at = current.offset;
              const offset = next ? Math.round(((at + next.offset) / 2) * 100) / 100 : at;
              const list = [...stops, { offset, color: current.color }].sort(
                (a, b) => a.offset - b.offset,
              );
              set(list);
              setSelected(list.findIndex((s) => s.offset === offset));
            }}
          >
            <Plus aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Remove this colour"
            disabled={stops.length <= 2}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
            onClick={() => {
              set(stops.filter((_, i) => i !== index));
              setSelected(Math.max(0, index - 1));
            }}
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** The Colour group of a kind that paints with the palette: where the colours come from, and which. */
function PaletteUse({ layer, kind, store }: { layer: ShaderLayer; kind: KindDef; store: Store }) {
  const scene = useStudio((s) => s.scene);
  const source = layer.params["source"] === "custom" ? "custom" : "palette";
  const highlight =
    typeof layer.params["highlight"] === "string" ? layer.params["highlight"] : "#C8FF2E";
  const colors = layerColors(scene, layer, kind);
  return (
    <>
      <Row label="Source">
        <div className="w-[170px]">
          <Pills
            label="Colour source"
            value={source}
            options={[
              { value: "palette", label: "Palette" },
              { value: "custom", label: "Custom" },
            ]}
            onChange={(v) => {
              store.getState().change((s) => setParam(s, layer.id, "source", v));
            }}
          />
        </div>
      </Row>
      <div className="flex items-center gap-1.5">
        {colors.map((color, i) => (
          <span
            key={i}
            aria-hidden
            className="size-[30px] shrink-0 rounded-lg border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.2)]"
            style={{ background: color }}
          />
        ))}
        <span className="ml-1 text-xs text-muted-foreground">
          {paletteUse(kind, scene.palette.length)}
        </span>
      </div>
      {source === "custom" ? (
        <Row label="Highlight">
          <ColorChip
            label="Highlight colour"
            value={highlight}
            size="size-7"
            onChange={(hex) => {
              store.getState().change((s) => setParam(s, layer.id, "highlight", hex));
            }}
            onStart={() => {
              store.getState().begin();
            }}
            onEnd={() => {
              store.getState().end();
            }}
          >
            <HexInput
              label="Highlight hex"
              value={highlight}
              className="h-7 w-[92px]"
              onChange={(hex) => {
                store.getState().change((s) => setParam(s, layer.id, "highlight", hex));
              }}
            />
          </ColorChip>
        </Row>
      ) : null}
    </>
  );
}

/** A setting that depends on another (the highlight colour on the source) is shown only while that has the right value. */
function visible(spec: ParamSpec, layer: ShaderLayer, kind: KindDef): boolean {
  if (!spec.when) return true;
  const other = kind.specs.find((s) => s.id === spec.when?.id);
  const value = other ? readParam(other, layer.params[other.id]) : layer.params[spec.when.id];
  return value === spec.when.equals;
}

const text = (value: ShaderParamValue | undefined): string =>
  typeof value === "string" ? value : "";

function SpecRow({
  spec,
  layer,
  kind,
  store,
}: {
  spec: ParamSpec;
  layer: ShaderLayer;
  kind: KindDef;
  store: Store;
}) {
  if (!visible(spec, layer, kind)) return null;
  const set = (value: Parameters<typeof setParam>[3]) => {
    store.getState().change((s) => setParam(s, layer.id, spec.id, value));
  };
  switch (spec.type) {
    case "number":
    case "int":
      return <NumberRow spec={spec} layer={layer} store={store} />;
    case "bool":
      return (
        <Row label={spec.label}>
          <Switch
            aria-label={spec.label}
            checked={readParam(spec, layer.params[spec.id]) === true}
            onCheckedChange={set}
          />
        </Row>
      );
    case "color": {
      const value = text(readParam(spec, layer.params[spec.id]));
      return (
        <Row label={spec.label}>
          <ColorChip
            label={spec.label}
            value={value}
            size="size-7"
            onChange={set}
            onStart={() => {
              store.getState().begin();
            }}
            onEnd={() => {
              store.getState().end();
            }}
          >
            <HexInput
              label={`${spec.label} hex`}
              value={value}
              className="h-7 w-[92px]"
              onChange={set}
            />
          </ColorChip>
        </Row>
      );
    }
    case "enum":
      return (
        <Pills
          label={spec.label}
          value={text(readParam(spec, layer.params[spec.id]))}
          options={spec.options.map((o) => ({ value: o.id, label: o.label }))}
          onChange={set}
        />
      );
    case "stops":
      return <StopsEditor layer={layer} spec={spec} store={store} />;
  }
}

/** The settings of one layer or effect, made from its description. */
function KindInspector({ layer, kind }: { layer: ShaderLayer; kind: KindDef }) {
  const store = useStudioStore();
  const defaults = kindDefaults(kind);
  const sceneSeed = useStudio((s) => s.scene.seed);
  const update = (patch: LayerPatch) => {
    store.getState().change((s) => patchLayer(s, layer.id, patch));
  };

  // First section, Motion, the other sections, Advanced.
  const groups: string[] = [];
  for (const spec of kind.specs) {
    if (spec.group !== "Motion" && !groups.includes(spec.group)) groups.push(spec.group);
  }
  const first = groups[0];
  const rest = groups.slice(1);
  const motionSpecs = kind.specs.filter((s) => s.group === "Motion");
  const hasMotion = !kind.still;

  const renderGroup = (group: string) => {
    const specs = kind.specs.filter((s) => s.group === group);
    const nodes: ReactNode[] = [];
    const colourKind = group === "Colour" && kind.colors !== 0;
    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i];
      if (!spec) continue;
      if (colourKind && (spec.id === "source" || spec.id === "highlight")) continue;
      const next = specs[i + 1];
      const pair =
        spec.type === "number" &&
        next?.type === "number" &&
        /X$/.test(spec.id) &&
        next.id === spec.id.replace(/X$/, "Y");
      if (pair && next.type === "number") {
        nodes.push(
          <PairRow
            key={spec.id}
            base={spec.id.replace(/X$/, "")}
            x={spec}
            y={next}
            layer={layer}
            store={store}
          />,
        );
        i += 1;
        continue;
      }
      nodes.push(<SpecRow key={spec.id} spec={spec} layer={layer} kind={kind} store={store} />);
    }
    if (colourKind)
      nodes.push(<PaletteUse key="palette" layer={layer} kind={kind} store={store} />);
    const reset = () => {
      store.getState().change((s) => resetParams(s, layer.id, group));
    };
    const changed = kind.specs.some(
      (s) =>
        s.group === group &&
        JSON.stringify(readParam(s, layer.params[s.id])) !== JSON.stringify(defaults[s.id]),
    );
    return (
      <Section key={group} title={group} onReset={reset} canReset={changed}>
        {nodes}
      </Section>
    );
  };

  const motion = hasMotion ? (
    <Section
      key="Motion"
      title="Motion"
      canReset={
        layer.speed !== kind.speed ||
        layer.direction !== undefined ||
        motionSpecs.some(
          (s) =>
            JSON.stringify(readParam(s, layer.params[s.id])) !== JSON.stringify(defaults[s.id]),
        )
      }
      onReset={() => {
        store
          .getState()
          .change((s) =>
            resetParams(
              patchLayer(s, layer.id, { speed: kind.speed, direction: undefined }),
              layer.id,
              "Motion",
            ),
          );
      }}
    >
      <Row label="Speed" hint="cycles per loop">
        <MiniStepper
          label="Speed"
          value={Math.round(layer.speed)}
          min={0}
          max={32}
          onChange={(speed) => {
            update({ speed });
          }}
        />
      </Row>
      {kind.role === "generator" ? (
        <Row label="Direction">
          <div
            role="radiogroup"
            aria-label="Direction"
            className="flex gap-0.5 rounded-lg bg-muted p-0.5"
          >
            {DIRECTIONS.map((d) => {
              const Icon = ARROWS[d];
              const on = (layer.direction ?? "right") === d;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  aria-label={`Direction ${d}`}
                  className={cn(
                    "flex h-7 w-8 items-center justify-center rounded-md",
                    on ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => {
                    update({ direction: d });
                  }}
                >
                  <Icon aria-hidden className="size-3.5" />
                </button>
              );
            })}
          </div>
        </Row>
      ) : null}
      {motionSpecs.map((spec) => (
        <SpecRow key={spec.id} spec={spec} layer={layer} kind={kind} store={store} />
      ))}
    </Section>
  ) : null;

  const advanced = (
    <Section
      key="Advanced"
      title="Advanced"
      canReset={layer.opacity !== 1 || layer.blend !== "normal" || layer.seed !== undefined}
      onReset={() => {
        update({ opacity: 1, blend: "normal" });
        store.getState().change((s) => ({
          ...s,
          layers: s.layers.map((l) => {
            if (l.id !== layer.id) return l;
            const copy = { ...l };
            delete copy.seed;
            return copy;
          }),
        }));
      }}
    >
      <Row label="Seed">
        <DecimalBox
          label="Layer seed"
          value={layer.seed ?? sceneSeed}
          min={0}
          max={4294967295}
          step={1}
          decimals={0}
          className="w-[84px]"
          onChange={(seed) => {
            update({ seed: Math.round(seed) });
          }}
        />
        <button
          type="button"
          aria-label="New layer seed"
          className="flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:text-foreground"
          onClick={() => {
            update({ seed: Math.floor(Math.random() * 100000) });
          }}
        >
          <Dices aria-hidden className="size-3.5" />
        </button>
      </Row>
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
              update({ opacity });
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
            update({ opacity: v / 100 });
          }}
        />
      </div>
      <Row label="Blend">
        <span className="relative inline-flex">
          <select
            aria-label="Blend"
            value={layer.blend}
            className="h-8 w-[150px] appearance-none rounded-md bg-muted pr-7 pl-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onChange={(e) => {
              update({ blend: e.target.value as BlendMode });
            }}
          >
            {BLEND_MODES.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden
            className="pointer-events-none absolute top-2.5 right-2 size-3.5 text-muted-foreground"
          />
        </span>
      </Row>
    </Section>
  );

  return (
    <>
      {first ? renderGroup(first) : null}
      {motion}
      {rest.map(renderGroup)}
      {advanced}
    </>
  );
}

/** The right column of the Studio: the layer that is selected. */
export function Inspector() {
  const store = useStudioStore();
  const scene = useStudio((s) => s.scene);
  const selected = useStudio((s) => s.selected);
  const layer = scene.layers.find((l) => l.id === selected);
  const [menu, setMenu] = useState(false);
  if (!layer) {
    return (
      <aside
        aria-label="Inspector"
        className="flex w-[320px] shrink-0 flex-col border-l border-border p-4"
      >
        <p className="rounded-lg px-2 py-8 text-center text-[13px] text-muted-foreground">
          Select a layer to edit it.
        </p>
      </aside>
    );
  }
  const kind = kindById(layer.kind);
  const role = layer.kind === "custom" ? (layer.role ?? "generator") : kind?.role;
  const subtitle =
    layer.kind === "custom"
      ? `Custom shader · ${role === "effect" ? "Effect" : "Generator"}`
      : `${role === "effect" ? "Effect" : "Generator"} · ${kind?.label ?? layer.kind}`;
  return (
    <aside
      aria-label="Inspector"
      className="flex min-h-0 w-[320px] shrink-0 flex-col border-l border-border"
    >
      <div className="flex items-center gap-3 border-b border-border p-4">
        <KindChip layer={layer} scene={scene} size={36} />
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-sm font-semibold">{layerLabel(layer)}</h2>
          <span className="truncate text-xs text-muted-foreground">{subtitle}</span>
        </div>
        <div className="relative">
          <button
            type="button"
            aria-label="More for this layer"
            aria-haspopup="menu"
            aria-expanded={menu}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
            onClick={() => {
              setMenu(!menu);
            }}
          >
            <span aria-hidden className="text-lg leading-none">
              ···
            </span>
          </button>
          <Popover
            open={menu}
            onClose={() => {
              setMenu(false);
            }}
            className="top-full right-0 mt-1 w-[160px]"
          >
            <div role="menu" aria-label="Layer actions">
              <MenuItem
                label="Duplicate"
                hint="⌘D"
                onClick={() => {
                  setMenu(false);
                  duplicate(store, layer.id);
                }}
              />
              <MenuItem
                label="Delete"
                danger
                onClick={() => {
                  setMenu(false);
                  remove(store, layer.id);
                }}
              />
            </div>
          </Popover>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {layer.kind === "custom" ? (
          <CustomInspector layer={layer} />
        ) : kind ? (
          <KindInspector layer={layer} kind={kind} />
        ) : (
          <p className="text-[13px] text-muted-foreground">
            This version of LumenGrab does not know this kind of layer. It is kept in the file and
            not drawn.
          </p>
        )}
      </div>
    </aside>
  );
}

export { removeLayer };
