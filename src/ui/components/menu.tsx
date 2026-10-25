import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/ui/lib/utils";

export interface MenuItem {
  label: string;
  /** The shortcut shown on the right, e.g. `⌘C`. */
  keys?: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** A thin line above this item. */
  separator?: boolean;
}

/**
 * A context menu at a point (design: History card menu). Arrow keys move, Enter runs, Esc and a click
 * outside close it. It stays inside the window.
 */
export function Menu({
  label,
  at,
  items,
  onClose,
}: {
  label: string;
  at: { x: number; y: number };
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState(at);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const x = Math.max(8, Math.min(at.x, window.innerWidth - box.width - 8));
    const y = Math.max(8, Math.min(at.y, window.innerHeight - box.height - 8));
    // The menu is measured after it is drawn once, so it can be kept inside the window.
    setPlace({ x, y });
  }, [at]);

  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const away = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const buttons = [
        ...(ref.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []),
      ];
      if (buttons.length === 0) return;
      e.preventDefault();
      const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = e.key === "ArrowDown" ? 1 : -1;
      buttons[(at + step + buttons.length) % buttons.length]?.focus();
    };
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", key, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      style={{ left: place.x, top: place.y }}
      className="fixed z-50 min-w-[220px] rounded-lg border border-border bg-card p-1 text-card-foreground shadow-[0_12px_32px_rgb(0_0_0/0.25)]"
    >
      {items.map((item) => (
        <div key={item.label}>
          {item.separator ? <div role="separator" className="my-1 h-px bg-border" /> : null}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={cn(
              "flex w-full items-center justify-between gap-6 rounded px-2 py-1.5 text-left text-[13px] outline-none hover:bg-muted focus-visible:bg-muted disabled:opacity-40",
              item.danger && "text-destructive",
            )}
            onClick={() => {
              onClose();
              item.run();
            }}
          >
            <span>{item.label}</span>
            {item.keys ? <span className="text-xs text-muted-foreground">{item.keys}</span> : null}
          </button>
        </div>
      ))}
    </div>
  );
}
