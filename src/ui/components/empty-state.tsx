import type { ComponentType, ReactNode } from "react";
import { cn } from "@/ui/lib/utils";

/** A centred "nothing here" message with an icon, a title, a line of help and the actions (design: History empty states). */
export function EmptyState({
  icon: Icon,
  title,
  children,
  actions,
  className,
  role,
}: {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
  role?: "alert" | "status";
}) {
  return (
    <div
      role={role}
      className={cn("flex flex-col items-center gap-3 px-6 py-16 text-center", className)}
    >
      <span className="flex size-12 items-center justify-center rounded-xl bg-brand/15 text-brand-foreground">
        <Icon aria-hidden className="size-6" />
      </span>
      <h2 className="text-lg font-semibold">{title}</h2>
      {children ? <p className="max-w-[420px] text-sm text-muted-foreground">{children}</p> : null}
      {actions ? <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </div>
  );
}
