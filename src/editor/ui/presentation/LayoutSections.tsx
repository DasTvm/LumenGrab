import { AlignHorizontalSpaceAround, Info } from "lucide-react";
import { Button } from "@/ui/components/button";
import { Switch } from "@/ui/components/switch";
import { cn } from "@/ui/lib/utils";
import { shadowTint } from "@/presentation/backgrounds";
import { balancedPadding } from "@/presentation/compose";
import {
  applyShadowPreset,
  detectShadowPreset,
  SHADOW_PRESETS,
  shadowOpacity,
  withOpacity,
  type ShadowPresetId,
} from "@/presentation/shadow-presets";
import { Section, Slider, SwatchRow } from "../controls";
import { NumberInput, SliderRow } from "./fields";
import { TrimEdges } from "./TrimEdges";
import { usePictureWidth, usePresentation } from "./use-presentation";

const px = (n: number) => `${String(Math.round(n))} px`;
const SIDES = [
  { key: "top", label: "T" },
  { key: "right", label: "R" },
  { key: "bottom", label: "B" },
  { key: "left", label: "L" },
] as const;

/** Padding (design): one slider, the auto-balance switch, the four edges and "Balance edges". */
export function PaddingSection() {
  const { p, set, start, end } = usePresentation();
  const { top, right, bottom, left } = p.padding;
  const even = top === right && right === bottom && bottom === left;
  const mean = balancedPadding(p.padding).top;
  return (
    <Section label="Padding" value={px(even ? top : mean)}>
      <Slider
        label="Padding"
        value={Math.round(even ? top : mean)}
        min={0}
        max={400}
        onStart={start}
        onEnd={end}
        onChange={(v) => {
          set((d) => {
            d.padding = { top: v, right: v, bottom: v, left: v };
          });
        }}
      />
      <div className="flex items-start justify-between gap-3 pt-1">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium">Auto-balance</span>
          <span className="text-[13px] text-muted-foreground">
            Padding follows the picture size and the aspect ratio.
          </span>
        </div>
        <Switch
          aria-label="Auto-balance"
          checked={p.autoBalance}
          onCheckedChange={(on) => {
            set((d) => {
              d.autoBalance = on;
              if (on) d.padding = balancedPadding(d.padding);
            });
          }}
        />
      </div>
      <div className="grid grid-cols-4 gap-2">
        {SIDES.map(({ key, label }) => (
          <NumberInput
            key={key}
            label={`Padding ${key}`}
            prefix={label}
            min={0}
            max={1000}
            value={Math.round(p.padding[key])}
            onChange={(v) => {
              set((d) => {
                if (d.autoBalance) d.padding = { top: v, right: v, bottom: v, left: v };
                else d.padding[key] = v;
              });
            }}
          />
        ))}
      </div>
      <Button
        variant="outline"
        className="h-9 gap-2"
        disabled={even}
        onClick={() => {
          set((d) => {
            d.padding = balancedPadding(d.padding);
          });
        }}
      >
        <AlignHorizontalSpaceAround aria-hidden className="size-4" />
        Balance edges
      </Button>
      <p className="text-[13px] text-muted-foreground">
        Makes all four edges equal after you change the aspect ratio or drag a single edge.
      </p>
      <TrimEdges />
    </Section>
  );
}

export function RadiusSection() {
  const { p, set, start, end } = usePresentation();
  return (
    <Section label="Corner radius" value={px(p.cornerRadius)}>
      <Slider
        label="Corner radius"
        value={Math.round(p.cornerRadius)}
        min={0}
        max={160}
        onStart={start}
        onEnd={end}
        onChange={(v) => {
          set((d) => {
            d.cornerRadius = v;
          });
        }}
      />
    </Section>
  );
}

const SHADOW_COLORS = ["#000000", "#18181B", "#1E3A8A"];

/** Shadow (design): on/off, the presets, blur, distance, opacity and colour. */
export function ShadowSection() {
  const { p, set, start, end } = usePresentation();
  const width = usePictureWidth();
  const s = p.shadow;
  const preset = detectShadowPreset(s, width);
  const opacity = Math.round(shadowOpacity(s) * 100);
  const tint = shadowTint(p.background, shadowOpacity(s));
  return (
    <section aria-label="Shadow" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-medium">Shadow</h3>
        <Switch
          aria-label="Shadow"
          checked={s.enabled}
          onCheckedChange={(on) => {
            set((d) => {
              d.shadow.enabled = on;
            });
          }}
        />
      </div>
      {s.enabled ? (
        <>
          <div
            role="radiogroup"
            aria-label="Shadow preset"
            className="grid grid-cols-4 gap-1 rounded-md bg-muted p-1"
          >
            {(
              [
                ...SHADOW_PRESETS.map((x) => ({ id: x.id, label: x.label })),
                { id: "custom", label: "Custom" },
              ] as { id: ShadowPresetId; label: string }[]
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={preset === o.id}
                className={cn(
                  "rounded-sm py-1 text-[13px] font-medium",
                  preset === o.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  if (o.id === "custom") return;
                  set((d) => {
                    d.shadow = applyShadowPreset(
                      d.shadow,
                      o.id as Exclude<ShadowPresetId, "custom">,
                      width,
                    );
                  });
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          <SliderRow label="Blur" value={px(s.blur)}>
            <Slider
              label="Shadow blur"
              value={Math.round(s.blur)}
              min={0}
              max={200}
              onStart={start}
              onEnd={end}
              onChange={(v) => {
                set((d) => {
                  d.shadow.blur = v;
                });
              }}
            />
          </SliderRow>
          <SliderRow label="Distance" value={px(s.y)}>
            <Slider
              label="Shadow distance"
              value={Math.round(s.y)}
              min={0}
              max={120}
              onStart={start}
              onEnd={end}
              onChange={(v) => {
                set((d) => {
                  d.shadow.y = v;
                });
              }}
            />
          </SliderRow>
          <SliderRow label="Opacity" value={`${String(opacity)}%`}>
            <Slider
              label="Shadow opacity"
              value={opacity}
              min={0}
              max={100}
              onStart={start}
              onEnd={end}
              onChange={(v) => {
                set((d) => {
                  d.shadow.color = withOpacity(d.shadow.color, v / 100);
                });
              }}
            />
          </SliderRow>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] text-muted-foreground">Color</span>
            <SwatchRow
              label="Shadow colour"
              value={s.color.slice(0, 7).toUpperCase()}
              colors={[...SHADOW_COLORS, tint.slice(0, 7)]}
              onChange={(hex) => {
                if (!hex) return;
                set((d) => {
                  d.shadow.color = withOpacity(hex, shadowOpacity(d.shadow));
                });
              }}
              onStart={start}
              onEnd={end}
            />
            <p className="flex gap-2 text-[13px] text-muted-foreground">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              The last swatch is a tone of the background.
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}
