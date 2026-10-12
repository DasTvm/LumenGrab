import { useEffect, useRef, useState } from "react";
import {
  Bookmark,
  BookmarkPlus,
  Check,
  Ellipsis,
  Pencil,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import { Button } from "@/ui/components/button";
import { cn } from "@/ui/lib/utils";
import {
  BUILTIN_LOOKS,
  builtinById,
  lookFromPresentation,
  lookMatches,
  type Look,
  type LookPart,
} from "@/presentation/looks";
import { isBuiltinName, LOOK_NAME_MAX } from "@/presentation/looks-store";
import { useStores } from "../context";
import { FACTORY_LOOK_ID } from "../mode";
import { useBackgroundBitmap } from "../background-image";
import { applyLookToDocument } from "./apply-look";
import { ConfirmDialog, SaveLookDialog, type SaveLookChoice } from "./dialogs";
import { looksStore, useLooks } from "./looks-instance";
import { LookThumb } from "./LookThumb";
import { usePictureWidth, usePresentation } from "./use-presentation";

/** The decoded background picture of one of the user's looks (read from the looks store), if it has one. */
function useLookBitmap(look: Look): ImageBitmap | null {
  const bg = look.parts.background;
  const asset = bg?.type === "image" ? bg.asset : "";
  const [made, setMade] = useState<{ asset: string; bitmap: ImageBitmap } | null>(null);
  useEffect(() => {
    if (!asset) return;
    let alive = true;
    let bitmap: ImageBitmap | null = null;
    void looksStore
      .getState()
      .readAsset(asset)
      .then((bytes) => (bytes ? createImageBitmap(new Blob([new Uint8Array(bytes)])) : null))
      .then((b) => {
        if (!b) return;
        if (alive) {
          bitmap = b;
          setMade({ asset, bitmap: b });
        } else b.close();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      bitmap?.close();
    };
  }, [asset]);
  return made && made.asset === asset ? made.bitmap : null;
}

interface TileProps {
  look: Look;
  own: boolean;
  selected: boolean;
  isDefault: boolean;
  renaming: boolean;
  menuOpen: boolean;
  onApply: () => void;
  onMakeDefault: () => void;
  onMenu: () => void;
  onRename: (name: string) => void;
  onMenuAction: (action: "update" | "rename" | "delete") => void;
}

function LookTile(props: TileProps) {
  const { look, own, selected, isDefault, renaming, menuOpen } = props;
  const bitmap = useLookBitmap(look);
  return (
    <div className="group relative flex min-w-0 flex-col gap-1.5 text-[13px]">
      <button
        type="button"
        aria-pressed={selected}
        aria-label={look.name}
        className={cn(
          "relative block overflow-hidden rounded-md",
          selected ? "ring-2 ring-primary ring-offset-1 ring-offset-card" : "ring-1 ring-border",
        )}
        onClick={props.onApply}
      >
        <LookThumb look={look} width={90} height={62} backgroundImage={bitmap} />
      </button>
      {isDefault ? (
        <span
          aria-label="Default look"
          role="img"
          className="pointer-events-none absolute top-1 right-1 flex size-[18px] items-center justify-center rounded-full bg-brand text-brand-foreground shadow-sm"
        >
          <Star aria-hidden className="size-3 fill-current" />
        </span>
      ) : (
        <button
          type="button"
          aria-label={`Use ${look.name} as default`}
          title="Use as default"
          className="absolute top-1 right-1 flex size-[22px] items-center justify-center rounded-full bg-card/90 opacity-0 shadow-sm group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={props.onMakeDefault}
        >
          <Star aria-hidden className="size-3.5" />
        </button>
      )}
      <button
        type="button"
        aria-label={`More actions for ${look.name}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="absolute top-1 left-1 flex size-[22px] items-center justify-center rounded-full bg-card/90 opacity-0 shadow-sm group-focus-within:opacity-100 group-hover:opacity-100"
        onClick={props.onMenu}
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </button>
      {renaming ? (
        <input
          data-testid="look-rename"
          aria-label="Look name"
          defaultValue={look.name}
          maxLength={LOOK_NAME_MAX}
          autoFocus
          className="h-6 min-w-0 rounded-sm border border-border bg-background px-1 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = look.name;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            props.onRename(e.currentTarget.value);
          }}
        />
      ) : (
        <span className={cn("truncate", selected ? "font-medium" : "text-muted-foreground")}>
          {look.name}
        </span>
      )}
      {menuOpen ? (
        <LookMenu
          own={own}
          isDefault={isDefault}
          onApply={props.onApply}
          onMakeDefault={props.onMakeDefault}
          onAction={props.onMenuAction}
          onClose={props.onMenu}
        />
      ) : null}
    </div>
  );
}

function LookMenu({
  own,
  isDefault,
  onApply,
  onMakeDefault,
  onAction,
  onClose,
}: {
  own: boolean;
  isDefault: boolean;
  onApply: () => void;
  onMakeDefault: () => void;
  onAction: (action: "update" | "rename" | "delete") => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      if (root.current && !root.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
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
  const item = (label: string, icon: React.ReactNode, run: () => void, danger = false) => (
    <button
      type="button"
      role="menuitem"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-[13px] hover:bg-muted",
        danger && "text-destructive",
      )}
      onClick={() => {
        onClose();
        run();
      }}
    >
      {icon}
      {label}
    </button>
  );
  return (
    <div
      ref={root}
      role="menu"
      aria-label="Look actions"
      className="absolute top-[66px] left-0 z-30 flex w-[200px] flex-col rounded-lg border border-border bg-card p-1 shadow-[0_8px_24px_rgb(0_0_0/0.18)]"
    >
      {item("Apply", <Check aria-hidden className="size-4" />, onApply)}
      {!isDefault
        ? item("Use as default", <Star aria-hidden className="size-4" />, onMakeDefault)
        : null}
      {own ? (
        <>
          {item(
            "Update with current settings",
            <RefreshCw aria-hidden className="size-4" />,
            () => {
              onAction("update");
            },
          )}
          {item("Rename", <Pencil aria-hidden className="size-4" />, () => {
            onAction("rename");
          })}
          <hr className="my-1 border-border" />
          {item(
            "Delete",
            <Trash2 aria-hidden className="size-4" />,
            () => {
              onAction("delete");
            },
            true,
          )}
        </>
      ) : null}
    </div>
  );
}

type Dialog =
  | { type: "save"; draft?: SaveLookChoice }
  | { type: "replace"; choice: SaveLookChoice }
  | { type: "delete"; look: Look }
  | null;

/**
 * Looks (design): the built-in gallery, "My looks", the default look. A click applies a look; hovering
 * shows the star (use as default) and the menu; "Save as my look" opens the dialog.
 */
export function LooksSection() {
  const { editor, ui, session } = useStores();
  const { p } = usePresentation();
  const width = usePictureWidth();
  const own = useLooks((s) => s.looks);
  const defaultLook = useLooks((s) => s.defaultLook);
  const error = useLooks((s) => s.error);
  useEffect(() => {
    void looksStore.getState().init();
  }, []);
  const bitmap = useBackgroundBitmap(session.assets, p.background);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);

  const all = [...BUILTIN_LOOKS, ...own];
  const active = all.find((l) => lookMatches(p, l, width)) ?? null;
  const toast = (
    icon: "saved" | "default" | "deleted",
    text: string,
    action?: { label: string; run: () => void },
  ) => {
    ui.getState().pushToast({ icon, text, ...(action ? { action } : {}) });
  };

  const apply = (look: Look) => {
    void applyLookToDocument(look, { editor, ui, session, width });
  };
  const makeDefault = (look: Look) => {
    void looksStore.getState().setDefault(look);
    toast("default", `${look.name} is now your default look`);
  };
  const defaultId = defaultLook?.id ?? FACTORY_LOOK_ID;
  const isDefault = (look: Look) => look.id === defaultId;

  /** The parts of the current settings for a look, with its picture stored next to the looks. */
  const partsNow = async (include: readonly LookPart[]) => {
    const made = lookFromPresentation(p, include, width, "x", "x");
    const bg = made.parts.background;
    if (bg?.type === "image") {
      const bytes = session.assets[bg.asset];
      if (bytes) await looksStore.getState().addAsset(bg.asset, bytes);
    }
    return made.parts;
  };

  const save = async (choice: SaveLookChoice, replace: boolean) => {
    const parts = await partsNow(choice.include);
    const result = await looksStore.getState().saveLook(choice.name, parts, { replace });
    if (result.status === "exists") {
      setDialog({ type: "replace", choice });
      return;
    }
    setDialog(null);
    if (choice.makeDefault) await looksStore.getState().setDefault(result.look);
    toast("saved", `Saved as “${result.look.name}”`);
  };

  const menuAction = async (look: Look, action: "update" | "rename" | "delete") => {
    if (action === "rename") setRenaming(look.id);
    else if (action === "delete") setDialog({ type: "delete", look });
    else {
      const parts = await partsNow(Object.keys(look.parts) as LookPart[]);
      await looksStore.getState().updateLook(look.id, parts);
      toast("saved", `Updated “${look.name}”`);
    }
  };

  const tile = (look: Look, isOwn: boolean) => (
    <LookTile
      key={look.id}
      look={look}
      own={isOwn}
      selected={active?.id === look.id}
      isDefault={isDefault(look)}
      renaming={renaming === look.id}
      menuOpen={menu === look.id}
      onApply={() => {
        apply(look);
      }}
      onMakeDefault={() => {
        makeDefault(look);
      }}
      onMenu={() => {
        setMenu(menu === look.id ? null : look.id);
      }}
      onRename={(name) => {
        setRenaming(null);
        const trimmed = name.trim();
        if (!trimmed || trimmed === look.name) return;
        if (
          isBuiltinName(trimmed) ||
          own.some((l) => l.id !== look.id && l.name.toLowerCase() === trimmed.toLowerCase())
        ) {
          toast("saved", `There is already a look called “${trimmed}”`);
          return;
        }
        void looksStore.getState().renameLook(look.id, trimmed);
      }}
      onMenuAction={(action) => {
        void menuAction(look, action);
      }}
    />
  );

  const effectiveDefault = defaultLook ?? builtinById(FACTORY_LOOK_ID);
  return (
    <section aria-label="Looks" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-medium">Looks</h3>
        <Button
          variant="outline"
          className="h-8 gap-1.5 px-2.5 text-[13px]"
          onClick={() => {
            setDialog({ type: "save" });
          }}
        >
          <Bookmark aria-hidden className="size-3.5" />
          Save as my look
        </Button>
      </div>
      <div className="grid grid-cols-3 gap-x-2 gap-y-3">
        {BUILTIN_LOOKS.map((l) => tile(l, false))}
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          My looks
        </h4>
        {own.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 rounded-lg bg-muted/60 px-4 py-4 text-center text-[13px] text-muted-foreground">
            <Bookmark aria-hidden className="size-4" />
            <p>
              Save the current background, padding and frame as a look, then reuse it with one
              click.
            </p>
            <Button
              variant="outline"
              className="h-8 gap-1.5 px-3 text-[13px]"
              onClick={() => {
                setDialog({ type: "save" });
              }}
            >
              <Bookmark aria-hidden className="size-3.5" />
              Save as my look
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-x-2 gap-y-3">
            {own.map((l) => tile(l, true))}
            <button
              type="button"
              className="flex min-w-0 flex-col gap-1.5 text-left text-[13px]"
              onClick={() => {
                setDialog({ type: "save" });
              }}
            >
              <span className="flex h-[62px] items-center justify-center rounded-md border border-dashed border-border bg-muted/50">
                <BookmarkPlus aria-hidden className="size-4 text-muted-foreground" />
              </span>
              <span className="truncate text-muted-foreground">Save current</span>
            </button>
          </div>
        )}
      </div>
      {active && isDefault(active) ? (
        <p className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-[13px] text-muted-foreground">
          <Star aria-hidden className="size-4" />
          {active.name} is your default look
        </p>
      ) : (
        <button
          type="button"
          className="flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] hover:bg-accent"
          onClick={() => {
            if (active) makeDefault(active);
            else {
              void partsNow([
                "background",
                "padding",
                "cornerRadius",
                "shadow",
                "frame",
                "aspect",
              ]).then((parts) => {
                const look: Look = { id: "custom", name: "Custom", parts };
                void looksStore.getState().setDefault(look);
                toast("default", "Your current settings are now your default look");
              });
            }
          }}
        >
          <Star aria-hidden className="size-4" />
          <span className="min-w-0 flex-1 truncate text-left">
            {active ? `Use “${active.name}” as default` : "Use these settings as default"}
          </span>
          <span className="text-xs text-muted-foreground">{`Default: ${effectiveDefault?.name ?? "none"}`}</span>
        </button>
      )}
      {error ? (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : null}
      {dialog?.type === "save" ? (
        <SaveLookDialog
          presentation={p}
          width={width}
          suggestedName={`My look ${String(own.length + 1)}`}
          {...(dialog.draft ? { draft: dialog.draft } : {})}
          backgroundImage={bitmap}
          onCancel={() => {
            setDialog(null);
          }}
          onSave={(choice) => {
            void save(choice, false);
          }}
        />
      ) : null}
      {dialog?.type === "replace" ? (
        <ConfirmDialog
          title={`Replace “${dialog.choice.name}”?`}
          body="You already have a look with this name. Replacing it can't be undone."
          confirm="Replace"
          onCancel={() => {
            setDialog({ type: "save", draft: dialog.choice });
          }}
          onConfirm={() => {
            void save(dialog.choice, true);
          }}
        />
      ) : null}
      {dialog?.type === "delete" ? (
        <ConfirmDialog
          title={`Delete “${dialog.look.name}”?`}
          body="The look is removed from your list. Captures you already edited keep their settings."
          confirm="Delete"
          destructive
          onCancel={() => {
            setDialog(null);
          }}
          onConfirm={() => {
            const { look } = dialog;
            setDialog(null);
            void looksStore
              .getState()
              .removeLook(look.id)
              .then((removed) => {
                if (!removed) return;
                toast("deleted", "Look deleted", {
                  label: "Undo",
                  run: () => {
                    void looksStore.getState().restoreLook(removed);
                  },
                });
              });
          }}
        />
      ) : null}
    </section>
  );
}
