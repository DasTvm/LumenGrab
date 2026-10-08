import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/ui/lib/utils";

/** Design system: Nav Item/Active (lime) and Nav Item/Default. */
export function NavItem({
  icon,
  active = false,
  className,
  children,
  ...props
}: { icon: ReactNode; active?: boolean } & ComponentProps<"button">) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4 [&_svg]:shrink-0",
        active
          ? "bg-brand text-brand-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        className,
      )}
      {...props}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}
