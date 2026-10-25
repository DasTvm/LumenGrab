import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/ui/lib/utils";

/**
 * The dim backdrop and the card of every dialog (design: Export, Unsaved changes, Could not
 * save). Esc closes it (if `onClose` is given), Tab stays inside, and the focus goes back where it was.
 */
export function Modal({
  label,
  onClose,
  className,
  children,
}: {
  label: string;
  onClose?: () => void;
  className?: string;
  children: ReactNode;
}) {
  const card = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const first = card.current?.querySelector<HTMLElement>("[autofocus], button, input, select");
    (card.current?.querySelector<HTMLElement>("[data-autofocus]") ?? first)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && close.current) {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !card.current) return;
      const items = [
        ...card.current.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), [tabindex="0"]',
        ),
      ];
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (!firstItem || !lastItem) return;
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    // Capture: the editor's own shortcuts must not run while a dialog is open.
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-6"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) close.current?.();
      }}
    >
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={cn(
          "flex w-[520px] max-w-full flex-col gap-4 rounded-xl border border-border bg-card p-6 text-card-foreground shadow-[0_20px_50px_rgb(0_0_0/0.3)]",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
