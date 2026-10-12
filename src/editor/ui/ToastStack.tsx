import { useEffect } from "react";
import { Bookmark, Star, Trash2 } from "lucide-react";
import { useStores, useUi } from "./context";
import type { Toast } from "./ui-store";

const ICONS = { saved: Bookmark, default: Star, deleted: Trash2 } as const;

function ToastView({ toast }: { toast: Toast }) {
  const { ui } = useStores();
  const Icon = ICONS[toast.icon];
  useEffect(() => {
    const timer = setTimeout(
      () => {
        ui.getState().dismissToast(toast.id);
      },
      toast.action ? 7000 : 4000,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [toast.id, toast.action, ui]);
  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-2.5 rounded-lg bg-primary px-3.5 py-2.5 text-[13px] text-primary-foreground shadow-[0_6px_20px_rgb(0_0_0/0.25)]"
    >
      <Icon aria-hidden className="size-4 text-brand" />
      <span>{toast.text}</span>
      {toast.action ? (
        <button
          type="button"
          className="font-semibold text-brand hover:underline"
          onClick={() => {
            ui.getState().dismissToast(toast.id);
            toast.action?.run();
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
    </div>
  );
}

/** The messages at the bottom left of the editor (design: Presentation toasts). */
export function ToastStack() {
  const toasts = useUi((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-6 left-6 z-40 flex flex-col gap-2"
      data-testid="toasts"
    >
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} />
      ))}
    </div>
  );
}
