import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Pill buttons like ChatGPT. Every size is at least 44 px tall (granny rule);
// buttons should carry an icon AND text — icon-only only where a label is in aria-label.
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground hover:bg-primary/85",
        secondary: "border border-border bg-secondary text-secondary-foreground hover:bg-popover-accent",
        ghost: "text-foreground hover:bg-accent",
        danger: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        md: "min-h-11 px-5 text-base",
        lg: "min-h-12 px-6 text-[1.05rem]",
        icon: "size-11",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      type={asChild ? undefined : (type ?? "button")}
      {...props}
    />
  );
}
