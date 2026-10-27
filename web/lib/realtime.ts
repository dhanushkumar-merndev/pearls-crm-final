"use client";

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useEffect, useId } from "react";
import { getSupabaseBrowser } from "./supabase/client";

/**
 * Changes made between the first load and joining (or while reconnecting) send no event, so the
 * queries reload when the channel is (re)joined. On the first join a query that has just loaded
 * (under 2 s ago) or is still loading is left alone: its answer is already as new as the join,
 * and reloading it would only fetch everything twice on every page. Any later change reloads it anyway.
 */
function reloadOnJoin(queryClient: QueryClient, keys: string) {
  let joined = false;
  return (status: string) => {
    if (status !== "SUBSCRIBED") return;
    const first = !joined;
    joined = true;
    for (const key of JSON.parse(keys) as unknown[][]) {
      // A key can be a prefix (["wa_inbox"] covers every filter of the inbox): all of them must be fresh.
      const matches = queryClient.getQueryCache().findAll({ queryKey: key });
      const fresh =
        matches.length > 0 &&
        matches.every(({ state }) => state.fetchStatus === "fetching" || Date.now() - state.dataUpdatedAt < 2_000);
      if (first && fresh) continue;
      void queryClient.invalidateQueries({ queryKey: key });
    }
  };
}

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
      .subscribe(reloadOnJoin(queryClient, keys));
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
      .subscribe(reloadOnJoin(queryClient, keys));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [phone, keys, queryClient, enabled, id]);
}

/** The admin's live BDM map: every heartbeat or state change reloads the given queries. */
export function useLiveBdm(queryKeys: unknown[][]) {
  const queryClient = useQueryClient();
  const keys = JSON.stringify(queryKeys);
  const id = useId();
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    const refresh = () => {
      for (const key of JSON.parse(keys) as unknown[][]) void queryClient.invalidateQueries({ queryKey: key });
    };
    const channel = supabase
      .channel(`bdm_live:${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bdm_live_status" }, refresh)
      .subscribe(reloadOnJoin(queryClient, keys));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [keys, queryClient, id]);
}
