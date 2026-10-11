import { useEffect, useRef } from "react";
import { cn } from "@/ui/lib/utils";
import { locate } from "../model/tree";
import { isGroup } from "@/document/layers";
import { useEditor, useStores } from "./context";

interface Props {
  at: { id: string; x: number; y: number };
  onClose: () => void;
  onRename: () => void;
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";
const SHIFT = isMac ? "⇧" : "Shift+";

/** The context menu of a layer (design: Layers states, "Context menu"). The same actions have shortcuts. */
export function LayerMenu({ at, onClose, onRename }: Props) {
  const { editor } = useStores();
  const layers = useEditor((s) => s.project.layers);
  const selection = useEditor((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);
  const layer = locate(layers, at.id)?.layer;

  // The listeners are added once. Re-adding them on every render would drop the key press that
  // changed the state (the window's own handler runs first, React re-renders in between).
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key);
    };
  }, []);

  if (!layer) return null;
  const state = editor.getState();
  const group = isGroup(layer);
  const item = (
    label: string,
    keys: string,
    run: () => void,
    options: { disabled?: boolean; danger?: boolean; separator?: boolean } = {},
  ) => (
    <>
      {options.separator ? <div role="separator" className="my-1 h-px bg-border" /> : null}
      <button
        type="button"
        role="menuitem"
        disabled={options.disabled}
        className={cn(
          "flex w-full items-center justify-between gap-6 rounded px-2 py-1.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-40",
          options.danger && "text-destructive",
        )}
        onClick={() => {
          run();
          onClose();
        }}
      >
        <span>{label}</span>
        <span className="text-xs text-muted-foreground">{keys}</span>
      </button>
    </>
  );

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Layer actions"
      className="fixed z-50 w-56 rounded-lg border border-border bg-card p-1 shadow-[0_8px_24px_rgb(0_0_0/0.18)]"
      style={{
        left: Math.min(at.x, window.innerWidth - 232),
        top: Math.min(at.y, window.innerHeight - 330),
      }}
    >
      {item("Rename", "Enter", onRename)}
      {item("Duplicate", `${MOD}D`, () => {
        state.duplicateLayers();
      })}
      {item(
        "Group",
        `${MOD}G`,
        () => {
          state.group();
        },
        { disabled: selection.length === 0 },
      )}
      {item(
        "Ungroup",
        `${SHIFT}${MOD}G`,
        () => {
          state.ungroup();
        },
        { disabled: !group },
      )}
      {item(
        "Bring to front",
        `${SHIFT}${MOD}]`,
        () => {
          state.reorder("front");
        },
        { separator: true },
      )}
      {item("Send to back", `${SHIFT}${MOD}[`, () => {
        state.reorder("back");
      })}
      {item(
        layer.visible === false ? "Show" : "Hide",
        "",
        () => {
          state.setVisible(at.id, layer.visible === false);
        },
        { separator: true },
      )}
      {item(layer.locked === true ? "Unlock" : "Lock", "", () => {
        state.setLocked(at.id, layer.locked !== true);
      })}
      {item(
        "Delete",
        "⌫",
        () => {
          state.deleteLayers();
        },
        { danger: true, separator: true },
      )}
    </div>
  );
}
