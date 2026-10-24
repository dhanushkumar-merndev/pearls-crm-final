"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId } from "react";
import { getSupabaseBrowser } from "./supabase/client";

/**
 * Live updates for one IST day's appointments (Today board, slot board): any change
 * by another desk refreshes the given queries. Realtime is used only where PLAN.md E2
 * allows it (bell, Today board, phone scan, BDM map).
 */
export function useLiveAppointments(day: string, queryKeys: unknown[][]) {
  const queryClient = useQueryClient();
  const keys = JSON.stringify(queryKeys);
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const refresh = () => {
      for (const key of JSON.parse(keys) as unknown[][]) void queryClient.invalidateQueries({ queryKey: key });
    };
    const channel = supabase
      .channel(`appointments:${day}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments", filter: `appt_date=eq.${day}` }, refresh)
      // Changes made between the first load and joining (or while reconnecting) send no event:
      // reload once each time the channel is (re)joined.
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [day, keys, queryClient]);
}

/**
 * Live WhatsApp (owner: "3–5 people chat, mostly real time"): a reply, a sent message or a
 * delivery tick changes that number's wa_threads row, and every screen allowed to see it
 * reloads the given queries. [phone] limits it to one conversation; null = any (the inbox).
 */
export function useLiveWhatsApp(phone: string | null | undefined, queryKeys: unknown[][], enabled = true) {
  const queryClient = useQueryClient();
  const keys = JSON.stringify(queryKeys);
  // Each subscriber needs its own channel: supabase-js returns the existing channel for a
  // topic, and an already-joined channel refuses new listeners (the sidebar and the inbox
  // both listen to all conversations).
  const id = useId();
  useEffect(() => {
    if (!enabled || phone === undefined) return;
    const supabase = getSupabaseBrowser();
    const refresh = () => {
      for (const key of JSON.parse(keys) as unknown[][]) void queryClient.invalidateQueries({ queryKey: key });
    };
    const channel = supabase
      .channel(`wa_threads:${phone ?? "all"}:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wa_threads", ...(phone ? { filter: `phone_e164=eq.${phone}` } : {}) },
        refresh,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [phone, keys, queryClient, enabled, id]);
}
