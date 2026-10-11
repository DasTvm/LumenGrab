import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Droplet,
  Eye,
  EyeOff,
  Focus,
  FolderClosed,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Grid3x3,
  Hash,
  Highlighter,
  Image as ImageIcon,
  Info,
  Lock,
  LockOpen,
  Pencil,
  Slash,
  Square,
  Trash2,
  Type,
  type LucideIcon,
} from "lucide-react";
import type { Layer } from "@/document/schema";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import { layerLabel } from "../model/labels";
import { useEditor, useStores, useUi } from "./context";
import { buildRows, dropPosition, dropTarget, type DropPosition, type Row } from "./layers-model";
import { LayerMenu } from "./LayerMenu";

const TYPE_ICONS: Record<string, LucideIcon> = {
  arrow: ArrowUpRight,
  line: Slash,
  rect: Square,
  ellipse: Circle,
  text: Type,
  counter: Hash,
  pencil: Pencil,
  highlighter: Highlighter,
  spotlight: Focus,
};

function typeIcon(layer: Layer, open: boolean): LucideIcon {
  if (layer.type === "group") return open ? FolderOpen : FolderClosed;
  if (layer.type === "redaction") {
    return layer["mode"] === "blur" ? Droplet : layer["mode"] === "pixelate" ? Grid3x3 : Square;
  }
  return TYPE_ICONS[layer.type] ?? Square;
}

/** The Layers tab (design: Layers panel): the stack, front first, with hide, lock, rename, reorder and groups. */
export function LayersPanel() {
  const { editor, ui } = useStores();
  const layers = useEditor((s) => s.project.layers);
  const selection = useEditor((s) => s.selection);
  const collapsed = useUi((s) => s.collapsed);
  const rows = buildRows(layers, collapsed);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<{ ids: string[] } | null>(null);
  const [over, setOver] = useState<{ id: string; position: DropPosition } | null>(null);
  const anchor = useRef<string | null>(null);

  const pick = (row: Row, e: React.MouseEvent) => {
    const id = row.layer.id;
    const state = editor.getState();
    if (e.shiftKey && anchor.current) {
      const ids = rows.map((r) => r.layer.id);
      const a = ids.indexOf(anchor.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        state.select(ids.slice(Math.min(a, b), Math.max(a, b) + 1));
        return;
      }
    }
    anchor.current = id;
    if (e.metaKey || e.ctrlKey) {
      state.select(
        state.selection.includes(id)
          ? state.selection.filter((s) => s !== id)
          : [...state.selection, id],
      );
    } else {
      state.select([id]);
    }
  };

  const count = selection.length;
  const canGroup = count > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2" data-testid="layers-panel">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Info aria-hidden className="size-3" />
        Top of the list is in front. Drag to reorder.
      </p>
      <ul
        aria-label="Layers"
        className="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto"
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null);
        }}
      >
        {rows.map((row) => {
          const layer = row.layer;
          const selected = selection.includes(layer.id);
          const Icon = typeIcon(layer, !row.collapsed);
          const hidden = layer.visible === false;
          const locked = layer.locked === true;
          const dropping = over?.id === layer.id ? over.position : null;
          return (
            <li
              key={layer.id}
              data-layer={layer.id}
              data-selected={selected}
              data-drop={dropping ?? undefined}
              role="option"
              aria-selected={selected}
              tabIndex={0}
              draggable={renaming !== layer.id}
              className={cn(
                "group/row relative flex h-9 shrink-0 cursor-default items-center gap-1.5 rounded-md px-1 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected && (count > 1 ? "bg-brand/25 ring-1 ring-primary" : "bg-muted"),
                !selected && "hover:bg-muted/60",
                row.dimmed && "text-muted-foreground",
                dropping === "inside" && "ring-2 ring-primary",
                dropping === "above" &&
                  "before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:bg-primary",
                dropping === "below" &&
                  "after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:bg-primary",
              )}
              style={{ paddingLeft: 4 + row.depth * 18 }}
              onClick={(e) => {
                pick(row, e);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                if (!selection.includes(layer.id)) editor.getState().select([layer.id]);
                setMenu({ id: layer.id, x: e.clientX, y: e.clientY });
              }}
              onDoubleClick={() => {
                setRenaming(layer.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  setRenaming(layer.id);
                } else if (e.key === " ") {
                  e.preventDefault();
                  editor.getState().select([layer.id]);
                }
              }}
              onDragStart={(e) => {
                const ids = selection.includes(layer.id) ? selection : [layer.id];
                if (!selection.includes(layer.id)) editor.getState().select([layer.id]);
                setDrag({ ids });
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", ids.join(","));
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              onDragOver={(e) => {
                if (!drag) return;
                const rect = e.currentTarget.getBoundingClientRect();
                const position = dropPosition(e.clientY - rect.top, rect.height, row.isGroup);
                if (!dropTarget(layers, drag.ids, layer.id, position)) {
                  setOver(null);
                  return;
                }
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setOver({ id: layer.id, position });
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (drag && over) {
                  const target = dropTarget(layers, drag.ids, over.id, over.position);
                  if (target) editor.getState().moveTo(drag.ids, target.parentId, target.index);
                }
                setDrag(null);
                setOver(null);
              }}
            >
              <GripVertical
                aria-hidden
                className="size-3.5 shrink-0 cursor-grab text-muted-foreground"
              />
              {row.isGroup ? (
                <button
                  type="button"
                  aria-label={
                    row.collapsed ? `Expand ${layerLabel(layer)}` : `Collapse ${layerLabel(layer)}`
                  }
                  aria-expanded={!row.collapsed}
                  className="flex size-4 shrink-0 items-center justify-center rounded text-foreground hover:bg-border"
                  onClick={(e) => {
                    e.stopPropagation();
                    ui.getState().toggleCollapsed(layer.id);
                  }}
                >
                  {row.collapsed ? (
                    <ChevronRight aria-hidden className="size-3.5" />
                  ) : (
                    <ChevronDown aria-hidden className="size-3.5" />
                  )}
                </button>
              ) : null}
              <Icon aria-hidden className="size-4 shrink-0" />
              {renaming === layer.id ? (
                <RenameField
                  initial={layerLabel(layer)}
                  onDone={(name) => {
                    if (name !== null && name !== layerLabel(layer))
                      editor.getState().rename(layer.id, name);
                    setRenaming(null);
                  }}
                />
              ) : (
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    hidden && "line-through decoration-muted-foreground/60",
                  )}
                >
                  {layerLabel(layer)}
                </span>
              )}
              {row.isGroup && row.collapsed ? (
                <span
                  aria-label={`${String(row.count)} layers inside`}
                  className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground"
                >
                  {row.count}
                </span>
              ) : null}
              <button
                type="button"
                aria-label={hidden ? `Show ${layerLabel(layer)}` : `Hide ${layerLabel(layer)}`}
                aria-pressed={hidden}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded hover:bg-border",
                  hidden
                    ? "text-foreground"
                    : "text-muted-foreground opacity-60 group-hover/row:opacity-100",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  editor.getState().setVisible(layer.id, hidden);
                }}
              >
                {hidden ? (
                  <EyeOff aria-hidden className="size-4" />
                ) : (
                  <Eye aria-hidden className="size-4" />
                )}
              </button>
              <button
                type="button"
                aria-label={locked ? `Unlock ${layerLabel(layer)}` : `Lock ${layerLabel(layer)}`}
                aria-pressed={locked}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded hover:bg-border",
                  locked
                    ? "text-foreground"
                    : "text-muted-foreground opacity-60 group-hover/row:opacity-100",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  editor.getState().setLocked(layer.id, !locked);
                }}
              >
                {locked ? (
                  <Lock aria-hidden className="size-4" />
                ) : (
                  <LockOpen aria-hidden className="size-4" />
                )}
              </button>
            </li>
          );
        })}
        <li
          aria-label="Screenshot (original)"
          className="flex h-9 shrink-0 items-center gap-1.5 px-1 text-[13px] text-muted-foreground"
        >
          <GripVertical aria-hidden className="size-3.5 shrink-0 opacity-30" />
          <ImageIcon aria-hidden className="size-4 shrink-0" />
          <span className="flex-1 truncate">Screenshot (original)</span>
          <Lock aria-hidden className="mr-1 size-4 text-foreground" />
        </li>
      </ul>
      <div className="flex items-center gap-1 border-t border-border pt-2">
        <Button
          variant="accent"
          className="h-8 gap-1.5 px-3 text-sm"
          disabled={!canGroup}
          onClick={() => {
            editor.getState().group();
          }}
        >
          <FolderPlus aria-hidden className="size-4" />
          {count > 1 ? `Group ${String(count)} layers` : "New group"}
        </Button>
        <span className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Duplicate"
          disabled={count === 0}
          onClick={() => {
            editor.getState().duplicateLayers();
          }}
        >
          <Copy aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="Delete"
          disabled={count === 0}
          onClick={() => {
            editor.getState().deleteLayers();
          }}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      {menu ? (
        <LayerMenu
          at={menu}
          onClose={() => {
            setMenu(null);
          }}
          onRename={() => {
            setRenaming(menu.id);
          }}
        />
      ) : null}
    </div>
  );
}

function RenameField({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (name: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      aria-label="Layer name"
      defaultValue={initial}
      maxLength={200}
      className="h-6 min-w-0 flex-1 rounded border border-primary bg-background px-1.5 text-[13px] outline-none"
      onClick={(e) => {
        e.stopPropagation();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") onDone(e.currentTarget.value);
        else if (e.key === "Escape") onDone(null);
      }}
      onBlur={(e) => {
        onDone(e.currentTarget.value);
      }}
    />
  );
}
