import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Circle,
  Droplet,
  Grid3x3,
  Info,
  Square,
  type LucideIcon,
} from "lucide-react";
import { useMemo } from "react";
import { cn } from "@/ui/lib/utils";
import { applyOptions, layerIsOf, optionsFromLayer, type StyleTool } from "../model/bindings";
import { nextCounterValue } from "../model/geometry";
import { findLayer } from "../model/tree";
import { Pills, Section, Slider, Stepper, SwatchRow } from "./controls";
import { FontPicker, fontLabel } from "./FontPicker";
import { useEditor, useStores, useUi } from "./context";
import { SWATCHES, type ToolOptions } from "./tools";
import type { Layer } from "@/document/schema";

/**
 * The values a tool's panel shows and how a change is applied: to the selected layers of that tool,
 * and to the defaults for new ones (the panel remembers the last choice).
 */
export interface ToolStyle<K extends StyleTool> {
  values: ToolOptions[K];
  set: (change: Partial<ToolOptions[K]>) => void;
  /** A slider drag is one undo step. */
  start: () => void;
  end: () => void;
}

export function useToolStyle<K extends StyleTool>(tool: K): ToolStyle<K> {
  const { editor, ui } = useStores();
  const options = useUi((s) => s.options[tool]);
  const layers = useEditor((s) => s.project.layers);
  const selection = useEditor((s) => s.selection);
  const targets = useMemo(
    () =>
      selection
        .map((id) => findLayer(layers, id))
        .filter((l): l is Layer => l !== null && layerIsOf(tool, l)),
    [layers, selection, tool],
  );
  const first = targets[0];
  const values = first ? optionsFromLayer(tool, first) : options;
  return {
    values,
    set: (change) => {
      ui.getState().setOption(tool, change);
      if (targets.length === 0) return;
      const ids = targets.filter((l) => !l.locked).map((l) => l.id);
      editor.getState().change((p) => {
        for (const id of ids) {
          const layer = findLayer(p.layers, id);
          if (layer) applyOptions(tool, layer, change);
        }
      });
    },
    start: () => {
      editor.getState().beginGesture();
    },
    end: () => {
      editor.getState().endGesture();
    },
  };
}

const px = (n: number) => `${String(n)} px`;
const pct = (n: number) => `${String(Math.round(n * 100))}%`;

function Note({ children }: { children: string }) {
  return (
    <p className="flex gap-2 text-[13px] text-muted-foreground">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
      {children}
    </p>
  );
}

const ARROW_STYLES = [
  { value: "straight", label: "Straight" },
  { value: "curved", label: "Curved" },
  { value: "outlined", label: "Outlined" },
  { value: "double", label: "Double" },
] as const;

function ArrowGlyph({ style }: { style: string }) {
  const shaft = style === "curved" ? "M3 17 Q 14 3 26 8" : "M3 17 L 24 6";
  return (
    <svg
      viewBox="0 0 32 22"
      className="h-[22px] w-8"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={shaft} />
      <path
        d={style === "curved" ? "M20 3 L 29 8 L 20 14 Z" : "M19 4 L 29 5 L 23 14 Z"}
        fill={style === "outlined" ? "var(--lg-background)" : "currentColor"}
      />
      {style === "double" ? <path d="M3 17 L 11 19 L 8 11 Z" fill="currentColor" /> : null}
    </svg>
  );
}

export function ArrowPanel() {
  const s = useToolStyle("arrow");
  return (
    <>
      <Section
        label="Style"
        value={ARROW_STYLES.find((a) => a.value === s.values.style)?.label ?? ""}
      >
        <div role="radiogroup" aria-label="Arrow style" className="grid grid-cols-4 gap-2">
          {ARROW_STYLES.map((a) => (
            <button
              key={a.value}
              type="button"
              role="radio"
              aria-checked={s.values.style === a.value}
              aria-label={a.label}
              className={cn(
                "flex h-11 items-center justify-center rounded-md border border-border text-foreground",
                s.values.style === a.value
                  ? "bg-muted ring-2 ring-primary"
                  : "bg-background hover:bg-muted/60",
              )}
              onClick={() => {
                s.set({ style: a.value });
              }}
            >
              <ArrowGlyph style={a.value} />
            </button>
          ))}
        </div>
      </Section>
      <Section label="Color" value={s.values.color}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Color"
          value={s.values.color}
          colors={SWATCHES.stroke}
          onChange={(c) => {
            if (c) s.set({ color: c });
          }}
        />
      </Section>
      <Section label="Width" value={px(s.values.width)}>
        <Slider
          label="Width"
          value={s.values.width}
          min={1}
          max={20}
          onChange={(width) => {
            s.set({ width });
          }}
          onStart={s.start}
          onEnd={s.end}
        />
      </Section>
    </>
  );
}

export function LinePanel() {
  const s = useToolStyle("line");
  return (
    <>
      <Section label="Color" value={s.values.color}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Color"
          value={s.values.color}
          colors={SWATCHES.stroke}
          onChange={(c) => {
            if (c) s.set({ color: c });
          }}
        />
      </Section>
      <Section label="Width" value={px(s.values.width)}>
        <Slider
          label="Width"
          value={s.values.width}
          min={1}
          max={20}
          onChange={(width) => {
            s.set({ width });
          }}
          onStart={s.start}
          onEnd={s.end}
        />
      </Section>
      <Section label="Style" value={s.values.dashed ? "Dashed" : "Solid"}>
        <Pills
          label="Line style"
          value={s.values.dashed ? "dashed" : "solid"}
          options={[
            { value: "solid", label: "Solid" },
            { value: "dashed", label: "Dashed" },
          ]}
          onChange={(v) => {
            s.set({ dashed: v === "dashed" });
          }}
        />
      </Section>
    </>
  );
}

export function RectPanel() {
  const s = useToolStyle("rect");
  return (
    <>
      <Section label="Stroke" value={s.values.stroke}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Stroke"
          value={s.values.stroke}
          colors={SWATCHES.stroke}
          onChange={(c) => {
            if (c) s.set({ stroke: c });
          }}
        />
      </Section>
      <Section label="Fill" value={s.values.fill ?? "None"}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Fill"
          none
          value={s.values.fill}
          colors={SWATCHES.fill}
          onChange={(fill) => {
            s.set({ fill });
          }}
        />
      </Section>
      <Section label="Stroke width" value={px(s.values.strokeWidth)}>
        <Slider
          label="Stroke width"
          value={s.values.strokeWidth}
          min={0}
          max={20}
          onChange={(strokeWidth) => {
            s.set({ strokeWidth });
          }}
          onStart={s.start}
          onEnd={s.end}
        />
      </Section>
      <Section label="Corner radius" value={px(s.values.radius)}>
        <Slider
          label="Corner radius"
          value={s.values.radius}
          min={0}
          max={32}
          onChange={(radius) => {
            s.set({ radius });
          }}
          onStart={s.start}
          onEnd={s.end}
        />
      </Section>
    </>
  );
}

export function EllipsePanel() {
  const s = useToolStyle("ellipse");
  return (
    <>
      <Section label="Stroke" value={s.values.stroke}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Stroke"
          value={s.values.stroke}
          colors={SWATCHES.stroke}
          onChange={(c) => {
            if (c) s.set({ stroke: c });
          }}
        />
      </Section>
      <Section label="Fill" value={s.values.fill ?? "None"}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Fill"
          none
          value={s.values.fill}
          colors={SWATCHES.fill}
          onChange={(fill) => {
            s.set({ fill });
          }}
        />
      </Section>
      <Section label="Stroke width" value={px(s.values.strokeWidth)}>
        <Slider
          label="Stroke width"
          value={s.values.strokeWidth}
          min={0}
          max={20}
          onChange={(strokeWidth) => {
            s.set({ strokeWidth });
          }}
          onStart={s.start}
          onEnd={s.end}
        />
      </Section>
    </>
  );
}

const ALIGN: { value: "left" | "center" | "right"; label: string; icon: LucideIcon }[] = [
  { value: "left", label: "Align left", icon: AlignLeft },
  { value: "center", label: "Align center", icon: AlignCenter },
  { value: "right", label: "Align right", icon: AlignRight },
];

export function TextPanel() {
  const s = useToolStyle("text");
  return (
    <>
      <Section label="Font" value={fontLabel(s.values.fontId)}>
        <FontPicker
          value={s.values.fontId}
          onChange={(fontId) => {
            s.set({ fontId });
          }}
        />
      </Section>
      <Section label="Size">
        <Stepper
          label="Size"
          value={s.values.size}
          min={8}
          max={200}
          step={2}
          onChange={(size) => {
            s.set({ size });
          }}
        />
      </Section>
      <Section label="Weight">
        <Pills
          label="Weight"
          value={String(s.values.weight)}
          options={[
            { value: "400", label: "Regular" },
            { value: "500", label: "Medium" },
            { value: "700", label: "Bold" },
          ]}
          onChange={(w) => {
            s.set({ weight: Number(w) });
          }}
        />
      </Section>
      <Section label="Color" value={s.values.color}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Color"
          value={s.values.color}
          colors={SWATCHES.textColor}
          onChange={(c) => {
            if (c) s.set({ color: c });
          }}
        />
      </Section>
      <Section label="Background" value={s.values.background ?? "None"}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Background"
          none
          value={s.values.background}
          colors={SWATCHES.textBackground}
          onChange={(background) => {
            s.set({ background });
          }}
        />
      </Section>
      <Section label="Align">
        <Pills
          label="Align"
          value={s.values.align}
          options={ALIGN.map((a) => ({
            value: a.value,
            label: a.label,
            iconOnly: true,
            icon: <a.icon aria-hidden className="size-3.5" />,
          }))}
          onChange={(align) => {
            s.set({ align });
          }}
        />
      </Section>
    </>
  );
}

export function CounterPanel() {
  const s = useToolStyle("counter");
  const { ui } = useStores();
  const layers = useEditor((st) => st.project.layers);
  const counterNext = useUi((st) => st.counterNext);
  const next = counterNext ?? nextCounterValue(layers);
  return (
    <>
      <Section label="Color" value={s.values.color}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Color"
          value={s.values.color}
          colors={SWATCHES.stroke}
          onChange={(c) => {
            if (c) s.set({ color: c });
          }}
        />
      </Section>
      <Section label="Size" value={px(s.values.size)}>
        <Slider
          label="Size"
          value={s.values.size}
          min={16}
          max={64}
          onChange={(size) => {
            s.set({ size });
          }}
          onStart={s.start}
          onEnd={s.end}
        />
      </Section>
      <Section label="Next number">
        <div className="flex items-center gap-3">
          <span
            data-testid="counter-next"
            className="flex size-8 items-center justify-center rounded-full text-[13px] font-bold text-white"
            style={{ background: s.values.color }}
          >
            {next}
          </span>
          <span className="flex-1 text-[13px] text-muted-foreground">
            Counts up with every click
          </span>
          <button
            type="button"
            className="text-[13px] font-medium underline-offset-2 hover:underline"
            onClick={() => {
              ui.getState().setCounterNext(1);
            }}
          >
            Restart at 1
          </button>
        </div>
      </Section>
    </>
  );
}

export function HighlighterPanel() {
  const s = useToolStyle("highlighter");
  return (
    <>
      <Section label="Color" value={s.values.color}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Color"
          value={s.values.color}
          colors={SWATCHES.highlighter}
          onChange={(c) => {
            if (c) s.set({ color: c });
          }}
        />
      </Section>
      <Section label="Opacity" value={pct(s.values.opacity)}>
        <Slider
          label="Opacity"
          value={Math.round(s.values.opacity * 100)}
          min={10}
          max={100}
          onChange={(v) => {
            s.set({ opacity: v / 100 });
          }}
          onStart={s.start}
          onEnd={s.end}
        />
      </Section>
      <Section label="Preview">
        <div className="relative flex h-14 items-center justify-center overflow-hidden rounded-md border border-border bg-white">
          <span
            aria-hidden
            className="absolute h-6 w-36 rounded-sm mix-blend-multiply"
            style={{ background: s.values.color, opacity: s.values.opacity }}
          />
          <span className="relative text-[13px] text-[#18181b]">Highlighted text</span>
        </div>
      </Section>
    </>
  );
}

export function PencilPanel() {
  const s = useToolStyle("pencil");
  return (
    <>
      <Section label="Color" value={s.values.color}>
        <SwatchRow
          onStart={s.start}
          onEnd={s.end}
          label="Color"
          value={s.values.color}
          colors={SWATCHES.stroke}
          onChange={(c) => {
            if (c) s.set({ color: c });
          }}
        />
      </Section>
      <Section label="Width" value={px(s.values.width)}>
        <Slider
          label="Width"
          value={s.values.width}
          min={1}
          max={20}
          onChange={(width) => {
            s.set({ width });
          }}
          onStart={s.start}
          onEnd={s.end}
        />
      </Section>
      <Section label="Smoothing" value={pct(s.values.smoothing)}>
        <Slider
          label="Smoothing"
          value={Math.round(s.values.smoothing * 100)}
          min={0}
          max={100}
          onChange={(v) => {
            s.set({ smoothing: v / 100 });
          }}
          onStart={s.start}
          onEnd={s.end}
        />
      </Section>
    </>
  );
}

export function SpotlightPanel() {
  const s = useToolStyle("spotlight");
  return (
    <>
      <Section label="Shape">
        <Pills
          label="Shape"
          value={s.values.shape}
          options={[
            {
              value: "rect",
              label: "Rectangle",
              icon: <Square aria-hidden className="size-3.5" />,
            },
            {
              value: "ellipse",
              label: "Ellipse",
              icon: <Circle aria-hidden className="size-3.5" />,
            },
          ]}
          onChange={(shape) => {
            s.set({ shape });
          }}
        />
      </Section>
      <Section label="Dim strength" value={pct(s.values.dimOpacity)}>
        <Slider
          label="Dim strength"
          value={Math.round(s.values.dimOpacity * 100)}
          min={10}
          max={95}
          onChange={(v) => {
            s.set({ dimOpacity: v / 100 });
          }}
          onStart={s.start}
          onEnd={s.end}
        />
      </Section>
      <Note>Dims everything outside the shape to draw the eye.</Note>
    </>
  );
}

export function RedactPanel() {
  const s = useToolStyle("redact");
  return (
    <>
      <Section
        label="Mode"
        value={{ blur: "Blur", pixelate: "Pixelate", solid: "Solid" }[s.values.mode]}
      >
        <Pills
          label="Mode"
          value={s.values.mode}
          options={[
            { value: "blur", label: "Blur", icon: <Droplet aria-hidden className="size-3.5" /> },
            {
              value: "pixelate",
              label: "Pixelate",
              icon: <Grid3x3 aria-hidden className="size-3.5" />,
            },
            { value: "solid", label: "Solid", icon: <Square aria-hidden className="size-3.5" /> },
          ]}
          onChange={(mode) => {
            s.set({ mode });
          }}
        />
      </Section>
      {s.values.mode === "solid" ? (
        <Section label="Color" value={s.values.color}>
          <SwatchRow
            onStart={s.start}
            onEnd={s.end}
            label="Color"
            value={s.values.color}
            colors={SWATCHES.solid}
            onChange={(c) => {
              if (c) s.set({ color: c });
            }}
          />
        </Section>
      ) : (
        <Section label="Strength" value={`${String(s.values.strength)}%`}>
          <Slider
            label="Strength"
            value={s.values.strength}
            min={0}
            max={100}
            onChange={(strength) => {
              s.set({ strength });
            }}
            onStart={s.start}
            onEnd={s.end}
          />
        </Section>
      )}
      <Note>
        {s.values.mode === "solid"
          ? "A solid box hides what is under it in every export."
          : "Blur and pixelate destroy the pixels in every flat export (PNG, JPG, WebP, clipboard)."}
      </Note>
    </>
  );
}

export function ToolPanelBody({ tool }: { tool: StyleTool }) {
  switch (tool) {
    case "arrow":
      return <ArrowPanel />;
    case "line":
      return <LinePanel />;
    case "rect":
      return <RectPanel />;
    case "ellipse":
      return <EllipsePanel />;
    case "text":
      return <TextPanel />;
    case "counter":
      return <CounterPanel />;
    case "highlighter":
      return <HighlighterPanel />;
    case "pencil":
      return <PencilPanel />;
    case "spotlight":
      return <SpotlightPanel />;
    case "redact":
      return <RedactPanel />;
  }
}
