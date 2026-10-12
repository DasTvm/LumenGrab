import { useState } from "react";
import { Check, ChevronDown, Expand, Frame, Ruler, Share2 } from "lucide-react";
import { Switch } from "@/ui/components/switch";
import { cn } from "@/ui/lib/utils";
import {
  aspectLabel,
  aspectOfBasic,
  aspectOfCustom,
  aspectOfSocial,
  BASIC_ASPECTS,
  describeAspect,
  parseRatio,
  ratioLabel,
  socialGroups,
  type SocialPreset,
} from "@/presentation/aspect-presets";
import { computeLayout } from "@/presentation/compose";
import { Section } from "../controls";
import { useStores, useUi } from "../context";
import { usePictureSize, usePresentation } from "./use-presentation";

/** A tile's rectangle in the shape of the ratio. */
function Shape({ ratio, selected }: { ratio: [number, number]; selected: boolean }) {
  const [w, h] = ratio;
  const long = 22;
  const width = w >= h ? long : (long * w) / h;
  const height = w >= h ? (long * h) / w : long;
  return (
    <span
      aria-hidden
      className={cn("block rounded-[3px]", selected ? "bg-primary" : "bg-muted-foreground/70")}
      style={{ width, height }}
    />
  );
}

function Tile({
  label,
  selected,
  onClick,
  children,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      className={cn(
        "flex h-[62px] flex-col items-center justify-center gap-1.5 rounded-md bg-muted text-xs",
        selected ? "ring-2 ring-primary" : "ring-1 ring-border hover:bg-muted/70",
      )}
      onClick={onClick}
    >
      <span className="flex h-6 items-center">{children}</span>
      <span className={selected ? "font-medium" : "text-muted-foreground"}>{label}</span>
    </button>
  );
}

function CustomRatio() {
  const { p, set } = usePresentation();
  const [bad, setBad] = useState(false);
  const ratio = p.aspect.ratio;
  return (
    <label
      className={cn(
        "flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-[13px] focus-within:ring-2 focus-within:ring-ring",
        bad ? "border-destructive" : "border-border",
      )}
    >
      <span className="text-muted-foreground">Ratio</span>
      <input
        aria-label="Custom ratio"
        key={ratio ? `${String(ratio[0])}:${String(ratio[1])}` : "none"}
        defaultValue={ratio ? `${String(ratio[0])}:${String(ratio[1])}` : ""}
        placeholder="e.g. 3:2"
        className="min-w-0 flex-1 bg-transparent text-right tabular-nums outline-none"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        onBlur={(e) => {
          const parsed = parseRatio(e.currentTarget.value);
          setBad(parsed === null && e.currentTarget.value.trim() !== "");
          if (parsed) {
            set((d) => {
              d.aspect = aspectOfCustom(parsed[0], parsed[1]);
            });
          }
        }}
      />
    </label>
  );
}

function BasicTab() {
  const { p, set } = usePresentation();
  const current = describeAspect(p.aspect);
  // "Custom" stays chosen while its field is open, even if the typed ratio equals a basic one.
  const [custom, setCustom] = useState(current.kind === "basic" && current.id === "custom");
  const active = custom ? "custom" : current.kind === "basic" ? current.id : "";
  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Aspect ratio" className="grid grid-cols-4 gap-2">
        {BASIC_ASPECTS.map((b) => (
          <Tile
            key={b.id}
            label={b.label}
            selected={active === b.id}
            onClick={() => {
              setCustom(false);
              set((d) => {
                d.aspect = aspectOfBasic(b);
              });
            }}
          >
            {b.ratio ? (
              <Shape ratio={b.ratio} selected={active === b.id} />
            ) : (
              <Expand aria-hidden className="size-5 text-muted-foreground" />
            )}
          </Tile>
        ))}
        <Tile
          label="Custom"
          selected={active === "custom"}
          onClick={() => {
            setCustom(true);
            set((d) => {
              if (describeAspect(d.aspect).kind === "social" || d.aspect.mode === "free")
                d.aspect = aspectOfCustom(3, 2);
            });
          }}
        >
          <Ruler aria-hidden className="size-5 text-muted-foreground" />
        </Tile>
      </div>
      {active === "custom" ? <CustomRatio /> : null}
    </div>
  );
}

function SocialRow({
  preset,
  selected,
  onPick,
}: {
  preset: SocialPreset;
  selected: boolean;
  onPick: () => void;
}) {
  const [w, h] = preset.size;
  const ratio = ratioLabel(w, h);
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(
        "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-[13px]",
        selected ? "bg-background ring-2 ring-primary" : "hover:bg-muted",
      )}
      onClick={onPick}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted">
        <Shape ratio={[w, h]} selected={selected} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{`${preset.label} · ${ratio}`}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{`${String(w)} × ${String(h)} px`}</span>
      </span>
      {selected ? <Check aria-hidden className="size-4" /> : null}
    </button>
  );
}

function SocialTab() {
  const { p, set } = usePresentation();
  const { ui } = useStores();
  const safeArea = useUi((s) => s.safeArea);
  const current = describeAspect(p.aspect);
  const active = current.kind === "social" ? current.preset : null;
  const groups = socialGroups();
  const [open, setOpen] = useState<string>(active?.platform ?? groups[0]?.platform ?? "");
  return (
    <div className="flex flex-col gap-2">
      {groups.map((g) => {
        const isOpen = open === g.platform;
        return (
          <div key={g.platform} className="rounded-md border border-border">
            <button
              type="button"
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between px-3 py-2 text-[13px] font-medium"
              onClick={() => {
                setOpen(isOpen ? "" : g.platform);
              }}
            >
              {g.platform}
              <span className="flex items-center gap-1.5 text-muted-foreground">
                {g.presets.length}
                <ChevronDown
                  aria-hidden
                  className={cn("size-4 transition-transform", isOpen && "rotate-180")}
                />
              </span>
            </button>
            {isOpen ? (
              <div
                role="radiogroup"
                aria-label={g.platform}
                className="flex flex-col gap-0.5 px-1 pb-1"
              >
                {g.presets.map((preset) => (
                  <SocialRow
                    key={preset.id}
                    preset={preset}
                    selected={active?.id === preset.id}
                    onPick={() => {
                      set((d) => {
                        d.aspect = aspectOfSocial(preset);
                      });
                    }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      <div className="flex items-start justify-between gap-3 pt-1">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-medium">Show safe area</span>
          <span className="text-[13px] text-muted-foreground">
            Shades the zones that apps cover with their own buttons.
          </span>
        </div>
        <Switch
          aria-label="Show safe area"
          checked={safeArea}
          onCheckedChange={(on) => {
            ui.getState().setSafeArea(on);
          }}
        />
      </div>
      {active ? (
        <p className="flex items-center justify-between text-[13px]">
          <span className="text-muted-foreground">Exports at exactly</span>
          <span className="tabular-nums">{`${String(active.size[0])} × ${String(active.size[1])} px`}</span>
        </p>
      ) : null}
      <p className="text-[13px] text-muted-foreground">
        Sizes follow the platforms&apos; current recommendations and can change. Use Custom for
        anything else.
      </p>
    </div>
  );
}

/** Aspect ratio (design): the basic ratios, the social formats, and the size that comes out. */
export function AspectSection() {
  const { p } = usePresentation();
  const picture = usePictureSize();
  const layout = computeLayout(picture, p);
  const current = describeAspect(p.aspect);
  const [tab, setTab] = useState<"basic" | "social">(
    current.kind === "social" ? "social" : "basic",
  );
  return (
    <Section label="Aspect ratio" value={aspectLabel(p.aspect)}>
      <div
        role="tablist"
        aria-label="Aspect ratio kind"
        className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1"
      >
        {(
          [
            { id: "basic", label: "Basic", icon: Frame },
            { id: "social", label: "Social", icon: Share2 },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-sm py-1.5 text-[13px] font-medium",
              tab === id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
            onClick={() => {
              setTab(id);
            }}
          >
            <Icon aria-hidden className="size-4" />
            {label}
          </button>
        ))}
      </div>
      {tab === "basic" ? <BasicTab /> : <SocialTab />}
      <p className="flex items-center justify-between text-[13px]" data-testid="output-size">
        <span className="text-muted-foreground">Output</span>
        <span className="tabular-nums">{`${String(layout.output.width)} × ${String(layout.output.height)} px`}</span>
      </p>
      {layout.clamped ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          The picture is larger than 16,384 px and was scaled down to fit.
        </p>
      ) : null}
    </Section>
  );
}
