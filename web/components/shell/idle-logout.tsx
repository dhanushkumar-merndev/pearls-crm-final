"use client";

import { useEffect } from "react";
import { signOut } from "./sign-out-button";

const EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "mousemove"] as const;

/**
 * Shared reception PCs: log out after N idle minutes (Admin → Settings → Security).
 * 0 turns it off. Activity in any tab of the app counts (via localStorage).
 */
export function IdleLogout({ minutes }: { minutes: number }) {
  useEffect(() => {
    if (!minutes) return;
    const key = "pearl.lastActivity";
    const limitMs = minutes * 60_000;
    let lastWrite = 0;
    const touch = () => {
      const now = Date.now();
      if (now - lastWrite > 5_000) {
        lastWrite = now;
        try {
          localStorage.setItem(key, String(now));
        } catch {
          // storage blocked: this tab's own timer still works
        }
      }
    };
    touch();
    for (const e of EVENTS) window.addEventListener(e, touch, { passive: true });
    const timer = window.setInterval(() => {
      let last = lastWrite;
      try {
        last = Math.max(last, Number(localStorage.getItem(key) ?? 0));
      } catch {
        // ignore
      }
      if (Date.now() - last > limitMs) void signOut("idle");
    }, 30_000);
    return () => {
      for (const e of EVENTS) window.removeEventListener(e, touch);
      window.clearInterval(timer);
    };
  }, [minutes]);
  return null;
}
