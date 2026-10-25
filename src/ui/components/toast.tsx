import type { ComponentType, ReactNode } from "react";

/** The dark message bar (design: Toast): an icon, a line of text and an optional action such as Undo. */
export function ToastBar({
  icon: Icon,
  children,
  action,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  children: ReactNode;
  action?: { label: string; run: () => void };
}) {
  return (
    <div
      role="status"
      className="pointer-events-auto flex items-center gap-2.5 rounded-lg border border-white/10 bg-toast px-3.5 py-2.5 text-[13px] text-toast-foreground shadow-[0_6px_20px_rgb(0_0_0/0.25)]"
    >
      <Icon aria-hidden className="size-4 text-brand" />
      <span>{children}</span>
      {action ? (
        <button
          type="button"
          className="font-semibold text-brand hover:underline"
          onClick={action.run}
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
