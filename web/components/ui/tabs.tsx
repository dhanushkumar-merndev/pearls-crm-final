"use client";

import { Tabs as T } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// One tab bar for the whole app. On a narrow screen the tabs scroll sideways in one row
// (never wrap into 3–4 rows); each tab keeps role="tab" and its name for screen readers and tests.
export const Tabs = T.Root;
export const TabsContent = T.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn(
        "flex max-w-full gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:thin]",
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "-mb-px inline-flex min-h-10 shrink-0 items-center rounded-t-lg border-b-2 focus-visible:-outline-offset-2 border-transparent px-3.5 font-medium whitespace-nowrap text-text-secondary hover:text-foreground",
        "data-[state=active]:border-foreground data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
