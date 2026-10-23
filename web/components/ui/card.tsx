import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Flat cards on the page colour with a hairline border (ChatGPT look). Charts sit
// on this surface: the chart palette is validated against the page colour.
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-2xl border border-border bg-card p-5", className)} {...props} />;
}

export function CardTitle({ className, ...props }: ComponentProps<"h2">) {
  return <h2 className={cn("text-lg font-semibold text-foreground", className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-[0.95rem] text-text-secondary", className)} {...props} />;
}

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-xl bg-muted", className)} {...props} />;
}
