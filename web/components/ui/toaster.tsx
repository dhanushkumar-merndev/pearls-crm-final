"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

/** Toasts after every save ("Saved ✓"), bottom-centre, big text. */
export function Toaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Sonner
      theme={resolvedTheme === "light" ? "light" : "dark"}
      position="bottom-center"
      toastOptions={{
        className: "!rounded-2xl !border-border !bg-popover !text-popover-foreground !text-base",
      }}
    />
  );
}
