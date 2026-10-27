import { useRef, useState } from "react";
import {
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  Layers as LayersIcon,
  Plus,
  Trash2,
  TriangleAlert,
  Code,
  Ellipsis,
} from "lucide-react";
import { cn } from "@/ui/lib/utils";
import { SHADER_LIMITS } from "@/document/limits";
import {
  addLayer,
  canAddLayer,
  duplicateLayer,
  moveLayer,
  patchLayer,
  removeLayer,
  setPalette,
} from "@/shader/edit";
import { EFFECTS, GENERATORS, kindById } from "@/shader/kinds";
import { layerLabel } from "@/shader/scene";
import { TEMPLATES } from "@/shader/scenes";
import { BLEND_MODES, type BlendMode, type LayerPatch, type ShaderLayer } from "@/shader/types";
import { ColorPicker } from "../ColorPicker";
import { useShaders } from "@/shader/shader-instance";
import { addCustom } from "@/shader/edit";
import { useStudio, useStudioStore } from "./context";
import { useStores } from "../context";
import { DecimalBox, KIND_ICONS, KindChip, MenuItem, MenuLabel, Popover } from "./parts";

/** The Palette card: the colours the layers paint with. */
function PaletteCard() {
  const store = useStudioStore();
  const palette = useStudio((s) => s.scene.palette);
  const [open, setOpen] = useState<number | null>(null);
  const edit = (next: string[]) => {
    store.getState().change((scene) => setPalette(scene, next));
  };
  return (
    <section aria-label="Palette" className="flex flex-col gap-2.5 rounded-xl bg-muted p-3">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold">Palette</h3>
        <span className="text-xs text-muted-foreground">
          {palette.length === 1 ? "1 colour" : `${String(palette.length)} colours`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {palette.map((color, i) => (
          <div key={i} className="relative">
            <button
              type="button"
              aria-label={`Palette colour ${String(i + 1)}`}
              aria-expanded={open === i}
              className="block size-[26px] rounded-lg border border-black/10"
              style={{ background: color }}
              onClick={() => {
                setOpen(open === i ? null : i);
              }}
            />
            {open === i ? (
              <div className="absolute top-full left-0 z-30 mt-1">
                <PaletteEditor
                  color={color}
                  canRemove={palette.length > 1}
                  onChange={(hex) => {
                    edit(palette.map((c, j) => (j === i ? hex : c)));
                  }}
                  onStart={() => {
                    store.getState().begin();
                  }}
                  onEnd={() => {
                    store.getState().end();
                  }}
                  onRemove={() => {
                    setOpen(null);
                    edit(palette.filter((_, j) => j !== i));
                  }}
                  onClose={() => {
                    setOpen(null);
                  }}
                />
              </div>
            ) : null}
          </div>
        ))}
        {palette.length < SHADER_LIMITS.maxPalette ? (
          <button
            type="button"
            aria-label="Add a palette colour"
            className="flex size-[26px] items-center justify-center rounded-lg border border-border bg-background text-muted-foreground hover:text-foreground"
            onClick={() => {
              edit([...palette, palette[palette.length - 1] ?? "#808080"]);
              setOpen(palette.length);
            }}
          >
            <Plus aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** The colour picker of one palette colour, with a way to remove it. */
function PaletteEditor({
  color,
  canRemove,
  onChange,
  onStart,
  onEnd,
  onRemove,
  onClose,
}: {
  color: string;
  canRemove: boolean;
  onChange: (hex: string) => void;
  onStart: () => void;
  onEnd: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <ColorChipPicker
      color={color}
      onChange={onChange}
      onStart={onStart}
      onEnd={onEnd}
      onClose={onClose}
    >
      {canRemove ? (
        <button
          type="button"
          className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-card text-[13px] text-destructive hover:bg-muted"
          onClick={onRemove}
        >
          <Trash2 aria-hidden className="size-3.5" /> Remove this colour
        </button>
      ) : null}
    </ColorChipPicker>
  );
}

function ColorChipPicker({
  color,
  onChange,
  onStart,
  onEnd,
  onClose,
  children,
}: {
  color: string;
  onChange: (hex: string) => void;
  onStart: () => void;
  onEnd: () => void;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <ColorPicker
        value={color.slice(0, 7)}
        onChange={onChange}
        onStart={onStart}
        onEnd={onEnd}
        onClose={onClose}
      />
      {children}
    </div>
  );
}

// ---- layers ------------------------------------------------------------------------------------

function LayerRow({
  layer,
  index,
  total,
  dropAbove,
  onGrab,
}: {
  layer: ShaderLayer;
  index: number;
  total: number;
  dropAbove: boolean;
  onGrab: (e: React.PointerEvent<HTMLButtonElement>, id: string) => void;
}) {
  const store = useStudioStore();
  const scene = useStudio((s) => s.scene);
  const selected = useStudio((s) => s.selected === layer.id);
  const solo = useStudio((s) => s.solo);
  const [menu, setMenu] = useState(false);
  const kind = kindById(layer.kind);
  const known = kind !== undefined || layer.kind === "custom";
  const dimmed = solo !== null && solo !== layer.id;
  const name = layerLabel(layer);
  const Eye_ = layer.enabled ? Eye : EyeOff;
  const update = (patch: LayerPatch) => {
    store.getState().change((s) => patchLayer(s, layer.id, patch));
  };
  const problem = !known ? "This version does not know this kind of layer." : null;
  return (
    <li
      data-layer={layer.id}
      className={cn(
        "relative flex h-10 items-center gap-1 rounded-lg pr-1 pl-0.5",
        selected && "bg-muted",
        dimmed && "opacity-45",
        dropAbove &&
          "before:absolute before:-top-px before:right-0 before:left-0 before:h-0.5 before:rounded-full before:bg-primary",
      )}
      aria-label={name}
      aria-current={selected ? "true" : undefined}
    >
      <button
        type="button"
        aria-label={`Move ${name}`}
        className="flex size-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
        onPointerDown={(e) => {
          onGrab(e, layer.id);
        }}
        onKeyDown={(e) => {
          if (!e.altKey) return;
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const from = scene.layers.findIndex((l) => l.id === layer.id);
            store
              .getState()
              .change((s) => moveLayer(s, layer.id, from + (e.key === "ArrowUp" ? 1 : -1)));
          }
        }}
      >
        <GripVertical aria-hidden className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={layer.enabled ? `Hide ${name}` : `Show ${name}`}
        aria-pressed={layer.enabled}
        className="flex size-4 shrink-0 items-center justify-center text-foreground"
        onClick={() => {
          update({ enabled: !layer.enabled });
        }}
      >
        <Eye_ aria-hidden className={cn("size-4", !layer.enabled && "text-muted-foreground")} />
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => {
          store.getState().select(layer.id);
        }}
        onDoubleClick={() => {
          if (layer.kind === "custom") store.getState().openEditor({ kind: "layer", id: layer.id });
        }}
      >
        <KindChip layer={layer} scene={scene} />
        <span
          className={cn(
            "truncate text-[13px] font-medium",
            !layer.enabled && "text-muted-foreground",
          )}
        >
          {name}
        </span>
        {problem ? (
          <span title={problem}>
            <TriangleAlert aria-label={problem} className="size-3.5 text-destructive" />
          </span>
        ) : null}
      </button>
      <span className="relative inline-flex shrink-0 items-center">
        <select
          aria-label={`Blend mode of ${name}`}
          value={layer.blend}
          className="h-6 w-[56px] appearance-none rounded-md bg-background py-0 pr-3 pl-1.5 text-[11px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          className="pointer-events-none absolute right-1 size-2.5 text-muted-foreground"
        />
      </span>
      <DecimalBox
        label={`Opacity of ${name}`}
        value={layer.opacity}
        min={0}
        max={1}
        step={0.05}
        decimals={0}
        scale={100}
        unit="%"
        className="w-[38px] bg-transparent px-0 text-[11px]"
        onChange={(opacity) => {
          update({ opacity });
        }}
      />
      <div className="relative">
        <button
          type="button"
          aria-label={`More for ${name}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          className="flex size-4 items-center justify-center rounded text-muted-foreground hover:text-foreground"
          onClick={() => {
            setMenu(!menu);
          }}
        >
          <Ellipsis aria-hidden className="size-4" />
        </button>
        <Popover
          open={menu}
          onClose={() => {
            setMenu(false);
          }}
          className="w-[168px]"
        >
          <div role="menu" aria-label={`Actions for ${name}`}>
            {layer.kind === "custom" ? (
              <MenuItem
                icon={<Code aria-hidden className="size-4" />}
                label="Edit code"
                onClick={() => {
                  setMenu(false);
                  store.getState().openEditor({ kind: "layer", id: layer.id });
                }}
              />
            ) : null}
            <MenuItem
              icon={<Copy aria-hidden className="size-4" />}
              label="Duplicate"
              hint="⌘D"
              onClick={() => {
                setMenu(false);
                duplicate(store, layer.id);
              }}
            />
            <MenuItem
              icon={<LayersIcon aria-hidden className="size-4" />}
              label={solo === layer.id ? "Stop solo" : "Solo"}
              onClick={() => {
                setMenu(false);
                store.getState().setSolo(solo === layer.id ? null : layer.id);
              }}
            />
            <MenuItem
              icon={<Trash2 aria-hidden className="size-4" />}
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
      <span className="sr-only">{`Layer ${String(index + 1)} of ${String(total)}`}</span>
    </li>
  );
}

type Store = ReturnType<typeof useStudioStore>;

export function duplicate(store: Store, id: string): void {
  const made = duplicateLayer(store.getState().scene, id);
  if (!made) {
    store.getState().setNotice("The stack is full. Remove a layer first.");
    return;
  }
  store.getState().change(() => made.scene);
  store.getState().select(made.id);
}

export function remove(store: Store, id: string): void {
  const before = store.getState().scene.layers;
  const at = before.findIndex((l) => l.id === id);
  store.getState().change((s) => removeLayer(s, id));
  const left = store.getState().scene.layers;
  store.getState().select(left[Math.min(at, left.length - 1)]?.id ?? null);
  if (store.getState().solo === id) store.getState().setSolo(null);
}

/** Add: a layer or an effect of any kind, or your own shader. */
function AddMenu({ onWriteShader }: { onWriteShader: () => void }) {
  const store = useStudioStore();
  const { session } = useStores();
  const mine = useShaders((s) => s.shaders);
  const [open, setOpen] = useState(false);
  const full = !useStudio((s) => canAddLayer(s.scene));
  const add = (kind: string) => {
    setOpen(false);
    const made = addLayer(store.getState().scene, kind);
    if (!made) return;
    store.getState().change(() => made.scene);
    store.getState().select(made.id);
  };
  const items = (list: typeof GENERATORS) =>
    list.map((k) => {
      const Icon = KIND_ICONS[k.id] ?? Code;
      return (
        <MenuItem
          key={k.id}
          icon={<Icon aria-hidden className="size-4" />}
          label={k.label}
          onClick={() => {
            add(k.id);
          }}
        />
      );
    });
  return (
    <div className="relative flex-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={full}
        title={full ? "The stack is full" : undefined}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-[13px] font-medium hover:bg-muted disabled:opacity-50"
        onClick={() => {
          setOpen(!open);
        }}
      >
        <Plus aria-hidden className="size-3.5" /> Add
      </button>
      <Popover
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        side="above"
        align="start"
        className="max-h-[560px] w-[256px]"
      >
        <div role="menu" aria-label="Add a layer">
          <MenuLabel>Generators</MenuLabel>
          {items(GENERATORS)}
          <MenuLabel>Effects</MenuLabel>
          {items(EFFECTS)}
          <MenuLabel>Custom</MenuLabel>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2.5 rounded-md bg-brand/40 px-2.5 py-1.5 text-left hover:bg-brand/60"
            onClick={() => {
              setOpen(false);
              onWriteShader();
            }}
          >
            <Code aria-hidden className="size-4" /> Write new shader…
          </button>
          {mine.length > 0 ? <MenuLabel>My shaders</MenuLabel> : null}
          {mine.map((shader) => (
            <MenuItem
              key={shader.id}
              icon={<Code aria-hidden className="size-4" />}
              label={shader.name}
              hint={shader.role === "effect" ? "Effect" : "Generator"}
              onClick={() => {
                setOpen(false);
                const made = addCustom(
                  store.getState().scene,
                  shader.role,
                  shader.name,
                  shader.code,
                  shader.values,
                );
                if (!made) return;
                session.noteOwnCode(shader.code);
                store.getState().change(() => made.scene);
                store.getState().select(made.id);
              }}
            />
          ))}
        </div>
      </Popover>
    </div>
  );
}

/** Start from: replaces the stack with a template. */
function TemplateMenu() {
  const store = useStudioStore();
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex-1">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-background text-[13px] font-medium hover:bg-muted"
        onClick={() => {
          setOpen(!open);
        }}
      >
        Start from… <ChevronDown aria-hidden className="size-3.5" />
      </button>
      <Popover
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        side="above"
        className="w-[240px]"
      >
        <div role="menu" aria-label="Start from">
          <MenuLabel>Start from</MenuLabel>
          {TEMPLATES.map((t) => {
            const made = t.make();
            return (
              <MenuItem
                key={t.id}
                label={t.name}
                hint={made.layers.length === 1 ? "1 layer" : `${String(made.layers.length)} layers`}
                onClick={() => {
                  setOpen(false);
                  const current = store.getState().scene;
                  store.getState().replaceScene({
                    ...made,
                    loop: current.loop,
                    poster: Math.min(current.poster, current.loop - 0.1),
                  });
                }}
              />
            );
          })}
        </div>
      </Popover>
    </div>
  );
}

/** The left column of the Studio: palette, layers, Add and Start from. */
export function StackPanel({ onWriteShader }: { onWriteShader: () => void }) {
  const store = useStudioStore();
  const layers = useStudio((s) => s.scene.layers);
  const rows = [...layers].reverse();
  const list = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; target: number } | null>(
    null,
  );

  const targetAt = (clientY: number): number => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>("[data-layer]") ?? [])];
    let target = items.length;
    for (let i = 0; i < items.length; i += 1) {
      const r = items[i]?.getBoundingClientRect();
      if (r && clientY < r.top + r.height / 2) {
        target = i;
        break;
      }
    }
    return target;
  };

  const grab = (e: React.PointerEvent<HTMLButtonElement>, id: string) => {
    e.preventDefault();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    store.getState().select(id);
    setDrag({ id, x: e.clientX, y: e.clientY, target: targetAt(e.clientY) });
    const move = (ev: PointerEvent) => {
      setDrag((d) =>
        d ? { ...d, x: ev.clientX, y: ev.clientY, target: targetAt(ev.clientY) } : d,
      );
    };
    const up = (ev: PointerEvent) => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", up);
      target.removeEventListener("pointercancel", up);
      const display = targetAt(ev.clientY);
      setDrag(null);
      const state = store.getState().scene.layers;
      const fromDisplay = [...state].reverse().findIndex((l) => l.id === id);
      // Dropping on its own place (or just below it) changes nothing.
      if (display === fromDisplay || display === fromDisplay + 1) return;
      const after = display > fromDisplay ? display - 1 : display;
      const index = state.length - 1 - after;
      store.getState().change((s) => moveLayer(s, id, index));
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", up);
    target.addEventListener("pointercancel", up);
  };

  const dragged = drag ? rows.find((l) => l.id === drag.id) : undefined;
  const dropBefore = drag ? rows[drag.target] : undefined;

  return (
    <div className="flex min-h-0 w-[280px] shrink-0 flex-col gap-4 border-r border-border p-4">
      <PaletteCard />
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          <h3>Layers</h3>
          <span className="tabular-nums">{layers.length}</span>
        </div>
        {rows.length === 0 ? (
          <p className="rounded-lg px-2 py-6 text-center text-[13px] text-muted-foreground">
            No layers yet. Add a generator to start.
          </p>
        ) : (
          <ul
            ref={list}
            aria-label="Layers"
            className="flex min-h-0 flex-col gap-0.5 overflow-y-auto"
          >
            {rows.map((layer, i) => (
              <LayerRow
                key={layer.id}
                layer={layer}
                index={i}
                total={rows.length}
                dropAbove={drag !== null && dropBefore?.id === layer.id && layer.id !== drag.id}
                onGrab={grab}
              />
            ))}
          </ul>
        )}
      </div>
      {drag && dragged ? (
        <div
          className="pointer-events-none fixed z-[60] flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-[13px] shadow-lg"
          style={{ left: drag.x + 12, top: drag.y + 8 }}
        >
          <span className="font-medium">{layerLabel(dragged)}</span>
          <span className="text-xs text-muted-foreground">
            {dropBefore && dropBefore.id !== dragged.id
              ? `Drop above ${layerLabel(dropBefore)}`
              : rows.length > 0 && drag.target >= rows.length
                ? "Drop at the bottom"
                : ""}
          </span>
        </div>
      ) : null}
      <div className="flex gap-2">
        <AddMenu onWriteShader={onWriteShader} />
        <TemplateMenu />
      </div>
    </div>
  );
}
