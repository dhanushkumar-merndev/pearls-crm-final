"use client";

import { useSyncExternalStore } from "react";

/**
 * True while the CSS media query matches. Before the page is interactive (server render) it
 * reports `serverValue`, so the first paint matches the desktop layout.
 */
export function useMediaQuery(query: string, serverValue = true): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** Tailwind's `sm` breakpoint (640 px): below it the pickers open as a bottom sheet. */
export const SM_UP = "(min-width: 640px)";
