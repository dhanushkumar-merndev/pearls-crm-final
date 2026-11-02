"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * A page choice (open tab, board day…) kept in the address, e.g. `/leads/1?tab=calls`.
 * Back from a page opened from here returns to the same choice, and a copied link keeps it.
 * The address is replaced, not pushed: changing tabs adds no Back steps, and the server is not asked again
 * (Next keeps `useSearchParams` in step with `history.replaceState`).
 * A missing or unknown value reads as `fallback`; choosing `fallback` removes the key.
 */
export function useUrlParam<T extends string>(key: string, fallback: T, isValid: (v: string) => v is T): [T, (v: T) => void] {
  const params = useSearchParams();
  const raw = params.get(key);
  const value = raw !== null && isValid(raw) ? raw : fallback;
  const set = useCallback(
    (v: T) => {
      const next = new URLSearchParams(window.location.search);
      if (v === fallback) next.delete(key);
      else next.set(key, v);
      const qs = next.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    },
    [key, fallback],
  );
  return [value, set];
}

/** The open tab of a tabbed page, kept in `?tab=` (see `useUrlParam`). */
export function useUrlTab<T extends string>(tabs: readonly T[], fallback: T): [T, (v: string) => void] {
  const isTab = useCallback((v: string): v is T => (tabs as readonly string[]).includes(v), [tabs]);
  const [tab, setTab] = useUrlParam<T>("tab", fallback, isTab);
  const choose = useCallback((v: string) => { if (isTab(v)) setTab(v); }, [isTab, setTab]);
  return [tab, choose];
}
