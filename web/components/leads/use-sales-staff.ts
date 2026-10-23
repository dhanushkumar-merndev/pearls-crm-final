"use client";

import { useQuery } from "@tanstack/react-query";
import { unwrap } from "@/lib/rpc";
import { getSupabaseBrowser } from "@/lib/supabase/client";
import type { SalesStaff } from "./types";

/** Active sales executives and managers (the staff directory is readable by every role). */
export function useSalesStaff() {
  return useQuery({
    queryKey: ["sales_staff"],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      unwrap(
        await getSupabaseBrowser()
          .from("staff")
          .select("id, full_name, role")
          .in("role", ["sales_executive", "sales_manager"])
          .eq("active", true)
          .order("full_name"),
      ) as SalesStaff[],
  });
}
