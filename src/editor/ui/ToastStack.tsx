import { useEffect } from "react";
import { Bookmark, Star, Trash2 } from "lucide-react";
import { ToastBar } from "@/ui/components/toast";
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
  const action = toast.action;
  return (
    <ToastBar
      icon={Icon}
      action={
        action
          ? {
              label: action.label,
              run: () => {
                ui.getState().dismissToast(toast.id);
                action.run();
              },
            }
          : undefined
      }
    >
      {toast.text}
    </ToastBar>
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
