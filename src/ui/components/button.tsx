import type { ComponentProps } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/ui/lib/utils";

/** Design system: Button/Primary, Accent, Secondary, Outline, Ghost, Destructive and the Icon Buttons. */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-base whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground font-medium hover:bg-primary/90",
        accent: "bg-brand text-brand-foreground font-semibold hover:bg-brand/85",
        secondary: "bg-secondary text-secondary-foreground font-medium hover:bg-secondary/70",
        outline: "border border-border bg-background text-foreground font-medium hover:bg-accent",
        ghost: "text-foreground font-medium hover:bg-accent",
        destructive:
          "bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90",
      },
      size: {
        default: "px-4 py-2",
        sm: "px-3 py-1.5 text-sm",
        icon: "size-9 [&_svg:not([class*='size-'])]:size-[18px]",
      },
      /** Icon buttons only: the selected tool. */
      active: { true: "bg-brand text-brand-foreground hover:bg-brand/85", false: "" },
    },
    defaultVariants: { variant: "default", size: "default", active: false },
  },
);

type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
  className,
  variant,
  size,
  active,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, active }), className)}
      {...(active !== undefined && active !== null ? { "aria-pressed": active } : {})}
      {...props}
    />
  );
}
