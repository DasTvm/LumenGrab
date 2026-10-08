import type { ComponentProps } from "react";
import { cn } from "@/ui/lib/utils";

/** Design system: Card (header slot with title and description, optional content and actions). */
export function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-card text-card-foreground", className)}
      {...props}
    />
  );
}

export function CardHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex flex-col gap-1 p-5">
      <h3 className="text-lg font-semibold">{title}</h3>
      {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
    </div>
  );
}
