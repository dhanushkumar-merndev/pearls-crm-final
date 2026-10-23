"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
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
