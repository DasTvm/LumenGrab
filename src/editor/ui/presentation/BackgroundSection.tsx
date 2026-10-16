import { useEffect, useRef, useState } from "react";
import {
  Blend,
  Droplet,
  Grid3x3,
  Image as ImageIcon,
  Plus,
  Shuffle,
  Sparkles,
  Square,
  ArrowLeftRight,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import type { Presentation } from "@/document/schema";
import { platform } from "@/platform";
import {
  addStop,
  BACKGROUND_TYPES,
  colorAtOffset,
  convertBackground,
  resizeMesh,
  reverseStops,
  shuffleGradient,
  shuffleMesh,
  SOLID_SWATCHES,
  type Background,
  type BackgroundType,
} from "@/presentation/backgrounds";
import { sortedStops } from "@/presentation/gradient";
import { DEFAULT_SMOOTHNESS, meshPoints, renderMeshField } from "@/presentation/mesh";
import { cssColor } from "@/editor/draw/color";
import { cn } from "@/ui/lib/utils";
import { Pills, Section, Slider, SwatchRow } from "../controls";
import { useStores } from "../context";
import { AnimatedEditor } from "./AnimatedSection";
import { ColorChip, HexInput, NumberInput, SliderRow } from "./fields";
import { usePresentation } from "./use-presentation";

const ICONS: Record<string, LucideIcon> = {
  solid: Square,
  gradient: Blend,
  mesh: Grid3x3,
  image: ImageIcon,
  "source-blur": Droplet,
  shader: Sparkles,
};

const TYPE_LABEL: Record<string, string> = {
  solid: "Solid",
  gradient: "Gradient",
  mesh: "Mesh",
  image: "Image",
  "source-blur": "Blur",
  shader: "Animated",
  transparent: "Transparent",
};

type Of<T extends Background["type"]> = Extract<Background, { type: T }>;

/** A seed for a shuffle: changes every time, but is stored in the document, so the result stays. */
const freshSeed = () => Math.floor(Math.random() * 0x7fffffff);

/** The Background section (design: Background, Angle): the type tabs and the controls of each type. */
export function BackgroundSection() {
  const { p, set } = usePresentation();
  const bg = p.background;
  const choose = (type: BackgroundType) => {
    set((draft) => {
      draft.background = convertBackground(draft.background, type, freshSeed());
    });
  };
  return (
    <Section label="Background" value={TYPE_LABEL[bg.type] ?? ""}>
      <div
        role="radiogroup"
        aria-label="Background type"
        className="grid grid-cols-6 gap-0.5 rounded-lg bg-muted p-1"
      >
        {BACKGROUND_TYPES.map((t) => {
          const Icon = ICONS[t.id] ?? Square;
          const selected = bg.type === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md py-1.5 text-[10px] font-medium",
                selected
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              onClick={() => {
                choose(t.id);
              }}
            >
              <Icon aria-hidden className="size-4" />
              {t.label}
            </button>
          );
        })}
      </div>
      {bg.type === "solid" ? <SolidEditor bg={bg} /> : null}
      {bg.type === "gradient" ? <GradientEditor bg={bg} /> : null}
      {bg.type === "mesh" ? <MeshEditor bg={bg} /> : null}
      {bg.type === "image" ? <ImageEditor bg={bg} /> : null}
      {bg.type === "source-blur" ? <BlurEditor bg={bg} /> : null}
      {bg.type === "shader" ? <AnimatedEditor bg={bg} /> : null}
    </Section>
  );
}

function SolidEditor({ bg }: { bg: Of<"solid"> }) {
  const { set, start, end } = usePresentation();
  const setColor = (color: string | null) => {
    if (!color) return;
    set((p) => {
      p.background = { type: "solid", color };
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <ColorChip
          label="Background colour"
          value={bg.color}
          onChange={setColor}
          onStart={start}
          onEnd={end}
        />
        <HexInput label="Hex" value={bg.color} onChange={setColor} className="flex-1" />
      </div>
      <SwatchRow
        label="Background colour"
        value={bg.color}
        colors={SOLID_SWATCHES}
        onChange={setColor}
        onStart={start}
        onEnd={end}
      />
    </div>
  );
}

// ---- gradient ---------------------------------------------------------------------------------

function GradientEditor({ bg }: { bg: Of<"gradient"> }) {
  const { set, start, end } = usePresentation();
  const stops = sortedStops(bg.stops);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, stops.length - 1);
  const current = stops[index];
  const bar = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const update = (recipe: (g: Of<"gradient">, list: Of<"gradient">["stops"]) => void) => {
    set((p) => {
      if (p.background.type !== "gradient") return;
      const list = sortedStops(p.background.stops).map((s) => ({ ...s }));
      recipe(p.background, list);
      p.background.stops = list;
    });
  };
  const css = `linear-gradient(90deg, ${stops.map((s) => `${cssColor(s.color)} ${String(s.offset * 100)}%`).join(", ")})`;
  const moveTo = (i: number, offset: number) => {
    update((_g, list) => {
      const lo = list[i - 1]?.offset ?? 0;
      const hi = list[i + 1]?.offset ?? 1;
      const target = list[i];
      if (target) target.offset = Math.round(Math.min(hi, Math.max(lo, offset)) * 100) / 100;
    });
  };
  const offsetAt = (clientX: number) => {
    const r = bar.current?.getBoundingClientRect();
    return r ? (clientX - r.left) / r.width : 0;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="px-2.5">
        <div
          ref={bar}
          data-testid="gradient-bar"
          className="h-9 cursor-copy rounded-md border border-black/10"
          style={{ background: css }}
          title="Click to add a colour"
          onClick={(e) => {
            if (dragging.current !== null) return;
            const offset = Math.round(offsetAt(e.clientX) * 100) / 100;
            const color = colorAtOffset(stops, offset);
            const next = sortedStops([...stops, { offset, color }]);
            set((p) => {
              if (p.background.type === "gradient") p.background.stops = next;
            });
            setSelected(next.findIndex((s) => s.offset === offset && s.color === color));
          }}
        />
        <div className="relative mt-2 h-5">
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
                dragging.current = i;
                start();
              }}
              onPointerMove={(e) => {
                if (dragging.current === i) moveTo(i, offsetAt(e.clientX));
              }}
              onPointerUp={(e) => {
                if (dragging.current !== i) return;
                e.currentTarget.releasePointerCapture(e.pointerId);
                dragging.current = null;
                end();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.1 : 0.01;
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  moveTo(i, stop.offset + (e.key === "ArrowLeft" ? -step : step));
                }
              }}
            />
          ))}
        </div>
      </div>
      {current ? (
        <div className="flex items-center gap-2">
          <ColorChip
            label="Colour of the stop"
            value={current.color}
            onChange={(hex) => {
              update((_g, list) => {
                const target = list[index];
                if (target) target.color = hex;
              });
            }}
            onStart={start}
            onEnd={end}
          >
            <HexInput
              label="Hex"
              value={current.color}
              className="w-[92px]"
              onChange={(hex) => {
                update((_g, list) => {
                  const target = list[index];
                  if (target) target.color = hex;
                });
              }}
            />
          </ColorChip>
          <NumberInput
            label="Stop position"
            prefix="at"
            suffix="%"
            min={0}
            max={100}
            value={Math.round(current.offset * 100)}
            onChange={(v) => {
              moveTo(index, v / 100);
            }}
            className="w-[88px]"
          />
          <button
            type="button"
            aria-label="Add a colour"
            disabled={stops.length >= 16}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
            onClick={() => {
              const added = addStop(stops, index);
              set((p) => {
                if (p.background.type === "gradient") p.background.stops = added.stops;
              });
              setSelected(added.index);
            }}
          >
            <Plus aria-hidden className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Remove this colour"
            disabled={stops.length <= 2}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted disabled:opacity-40"
            onClick={() => {
              update((_g, list) => {
                list.splice(index, 1);
              });
              setSelected(Math.max(0, index - 1));
            }}
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Pills
            label="Gradient kind"
            value={bg.kind ?? "linear"}
            options={[
              { value: "linear", label: "Linear" },
              { value: "radial", label: "Radial" },
            ]}
            onChange={(kind) => {
              set((p) => {
                if (p.background.type === "gradient") p.background.kind = kind;
              });
            }}
          />
        </div>
        <button
          type="button"
          aria-label="Reverse the colours"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          onClick={() => {
            set((p) => {
              if (p.background.type === "gradient") p.background = reverseStops(p.background);
            });
          }}
        >
          <ArrowLeftRight aria-hidden className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Shuffle the colours"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          onClick={() => {
            set((p) => {
              if (p.background.type === "gradient")
                p.background = shuffleGradient(p.background, freshSeed());
            });
            setSelected(0);
          }}
        >
          <Shuffle aria-hidden className="size-4" />
        </button>
      </div>
      {(bg.kind ?? "linear") === "linear" ? (
        <SliderRow label="Angle" value={`${String(Math.round(bg.angle))}°`}>
          <Slider
            label="Angle"
            value={Math.round(bg.angle)}
            min={0}
            max={360}
            onStart={start}
            onEnd={end}
            onChange={(angle) => {
              set((p) => {
                if (p.background.type === "gradient") p.background.angle = angle;
              });
            }}
          />
        </SliderRow>
      ) : null}
    </div>
  );
}

// ---- mesh -------------------------------------------------------------------------------------

function MeshEditor({ bg }: { bg: Of<"mesh"> }) {
  const { set, start, end } = usePresentation();
  const points = meshPoints(bg);
  const [selected, setSelected] = useState(0);
  const index = Math.min(selected, bg.colors.length - 1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const side = Math.round(Math.sqrt(bg.colors.length)) === 4 ? 4 : 3;

  // The picture of the mesh (a small field, scaled up by the browser).
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    el.width = 64;
    el.height = 40;
    ctx.putImageData(new ImageData(renderMeshField(bg, 64, 40), 64, 40), 0, 0);
  }, [bg]);

  const update = (recipe: (m: Of<"mesh">) => void) => {
    set((p) => {
      if (p.background.type === "mesh") recipe(p.background);
    });
  };
  const moveTo = (i: number, clientX: number, clientY: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height));
    update((m) => {
      const next = meshPoints(m).map((pt) => [...pt] as [number, number]);
      next[i] = [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000];
      m.points = next;
    });
  };
  const color = bg.colors[index] ?? "#808080";
  const setColor = (hex: string) => {
    update((m) => {
      m.colors[index] = hex;
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={box}
        data-testid="mesh-preview"
        className="relative aspect-[8/5] w-full rounded-md border border-black/10"
      >
        <canvas ref={canvas} aria-hidden className="absolute inset-0 size-full rounded-md" />
        {points.map((pt, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Mesh point ${String(i + 1)}`}
            aria-pressed={i === index}
            className={cn(
              "absolute size-4 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35)]",
              i === index && "ring-2 ring-primary",
            )}
            style={{
              left: `${String(pt[0] * 100)}%`,
              top: `${String(pt[1] * 100)}%`,
              background: (bg.colors[i] ?? "#808080").slice(0, 7),
            }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              setSelected(i);
              dragging.current = i;
              start();
            }}
            onPointerMove={(e) => {
              if (dragging.current === i) moveTo(i, e.clientX, e.clientY);
            }}
            onPointerUp={(e) => {
              if (dragging.current !== i) return;
              e.currentTarget.releasePointerCapture(e.pointerId);
              dragging.current = null;
              end();
            }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <ColorChip
          label="Colour of the point"
          value={color}
          onChange={setColor}
          onStart={start}
          onEnd={end}
        >
          <HexInput label="Hex" value={color} onChange={setColor} className="w-[92px]" />
        </ColorChip>
        <div className="flex-1" />
        <button
          type="button"
          aria-label="Shuffle the mesh"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
          onClick={() => {
            update((m) => {
              Object.assign(m, shuffleMesh(m, freshSeed()));
              delete m.points;
            });
          }}
        >
          <Shuffle aria-hidden className="size-4" />
        </button>
      </div>
      <Pills
        label="Mesh size"
        value={String(side) as "3" | "4"}
        options={[
          { value: "3", label: "3 × 3" },
          { value: "4", label: "4 × 4" },
        ]}
        onChange={(v) => {
          set((p) => {
            if (p.background.type === "mesh")
              p.background = resizeMesh(p.background, v === "4" ? 4 : 3);
          });
          setSelected(0);
        }}
      />
      <SliderRow
        label="Smoothness"
        value={`${String(Math.round((bg.smoothness ?? DEFAULT_SMOOTHNESS) * 100))}%`}
      >
        <Slider
          label="Smoothness"
          value={Math.round((bg.smoothness ?? DEFAULT_SMOOTHNESS) * 100)}
          min={0}
          max={100}
          onStart={start}
          onEnd={end}
          onChange={(v) => {
            update((m) => {
              m.smoothness = v / 100;
            });
          }}
        />
      </SliderRow>
      <p className="text-[13px] text-muted-foreground">
        Drag a point to move it, click it to change its colour. Shuffle gives a fresh mesh.
      </p>
    </div>
  );
}

// ---- image ------------------------------------------------------------------------------------

function ImageEditor({ bg }: { bg: Of<"image"> }) {
  const { session } = useStores();
  const { set, start, end } = usePresentation();
  const [error, setError] = useState<string | null>(null);
  const bytes = bg.asset ? session.assets[bg.asset] : undefined;
  const [shown, setShown] = useState<{ bytes: Uint8Array; url: string } | null>(null);
  useEffect(() => {
    if (!bytes) return;
    const made = URL.createObjectURL(new Blob([new Uint8Array(bytes)]));
    queueMicrotask(() => {
      setShown({ bytes, url: made });
    });
    return () => {
      URL.revokeObjectURL(made);
    };
  }, [bytes]);
  const url = shown && shown.bytes === bytes ? shown.url : null;

  const takePicture = async (data: Uint8Array | null) => {
    if (!data) return;
    const named = await session.addAsset(data);
    if ("error" in named) {
      setError(named.error);
      return;
    }
    setError(null);
    set((p) => {
      if (p.background.type === "image") p.background.asset = named.name;
      else p.background = { type: "image", asset: named.name, fit: "cover" };
    });
  };
  const choose = async () => {
    try {
      await takePicture(await platform.pickImage());
    } catch (e) {
      setError(e instanceof Error ? e.message : "The picture could not be read.");
    }
  };
  const missing = bg.asset !== "" && !bytes;

  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        data-testid="image-drop"
        className="flex h-28 w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-md border border-dashed border-border bg-muted/50 text-[13px] text-muted-foreground hover:bg-muted"
        onClick={() => void choose()}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) void file.arrayBuffer().then((b) => takePicture(new Uint8Array(b)));
        }}
      >
        {url ? (
          <img src={url} alt="Background picture" className="size-full object-cover" />
        ) : (
          <>
            <ImageIcon aria-hidden className="size-5" />
            {missing ? "The picture is missing. Choose another." : "Drop an image or choose one"}
          </>
        )}
      </button>
      {url ? (
        <button
          type="button"
          className="self-start text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          onClick={() => void choose()}
        >
          Choose another…
        </button>
      ) : null}
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      <Pills
        label="Image fit"
        value={bg.fit}
        options={[
          { value: "cover", label: "Cover" },
          { value: "contain", label: "Contain" },
        ]}
        onChange={(fit) => {
          set((p) => {
            if (p.background.type === "image") p.background.fit = fit;
          });
        }}
      />
      <SliderRow label="Blur" value={`${String(Math.round(bg.blur ?? 0))} px`}>
        <Slider
          label="Image blur"
          value={Math.round(bg.blur ?? 0)}
          min={0}
          max={60}
          onStart={start}
          onEnd={end}
          onChange={(v) => {
            set((p) => {
              if (p.background.type === "image") p.background.blur = v;
            });
          }}
        />
      </SliderRow>
      <SliderRow label="Dim" value={`${String(Math.round((bg.dim ?? 0) * 100))}%`}>
        <Slider
          label="Image dim"
          value={Math.round((bg.dim ?? 0) * 100)}
          min={0}
          max={80}
          onStart={start}
          onEnd={end}
          onChange={(v) => {
            set((p) => {
              if (p.background.type === "image") p.background.dim = v / 100;
            });
          }}
        />
      </SliderRow>
      <p className="text-[13px] text-muted-foreground">
        Images stay on your device and are stored inside the file. PNG, JPG or WebP, up to 20 MB.
      </p>
    </div>
  );
}

// ---- blurred screenshot -------------------------------------------------------------------------

function BlurEditor({ bg }: { bg: Of<"source-blur"> }) {
  const { set, start, end } = usePresentation();
  const row = (
    key: "blur" | "zoom" | "dim" | "saturation",
    label: string,
    value: number,
    text: string,
    min: number,
    max: number,
    toDoc: (v: number) => number,
  ) => (
    <SliderRow label={label} value={text}>
      <Slider
        label={label}
        value={value}
        min={min}
        max={max}
        onStart={start}
        onEnd={end}
        onChange={(v) => {
          set((p: Presentation) => {
            if (p.background.type === "source-blur") p.background[key] = toDoc(v);
          });
        }}
      />
    </SliderRow>
  );
  return (
    <div className="flex flex-col gap-3">
      {row(
        "blur",
        "Blur",
        Math.round(bg.blur),
        `${String(Math.round(bg.blur))} px`,
        0,
        120,
        (v) => v,
      )}
      {row(
        "zoom",
        "Zoom",
        Math.round(bg.zoom * 100),
        `${String(Math.round(bg.zoom * 100))}%`,
        100,
        300,
        (v) => v / 100,
      )}
      {row(
        "dim",
        "Dim",
        Math.round(bg.dim * 100),
        `${String(Math.round(bg.dim * 100))}%`,
        0,
        80,
        (v) => v / 100,
      )}
      {row(
        "saturation",
        "Saturation",
        Math.round(bg.saturation * 100),
        `${String(Math.round(bg.saturation * 100))}%`,
        0,
        200,
        (v) => v / 100,
      )}
      <p className="text-[13px] text-muted-foreground">
        Your own screenshot, enlarged and blurred, becomes the background. No extra image needed.
      </p>
    </div>
  );
}
