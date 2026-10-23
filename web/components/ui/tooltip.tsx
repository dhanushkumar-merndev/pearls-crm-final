"use client";

import { Tooltip as Tip } from "radix-ui";
import type { ReactNode } from "react";

export const TooltipProvider = Tip.Provider;

export function Tooltip({ label, children, side = "right" }: { label: string; children: ReactNode; side?: "top" | "right" | "bottom" | "left" }) {
  return (
    <Tip.Root delayDuration={300}>
      <Tip.Trigger asChild>{children}</Tip.Trigger>
      <Tip.Portal>
        <Tip.Content
          side={side}
          sideOffset={8}
          className="z-50 rounded-lg bg-primary px-3 py-1.5 text-[0.9rem] font-medium text-primary-foreground shadow-lg"
        >
          {label}
        </Tip.Content>
      </Tip.Portal>
    </Tip.Root>
  );
}
