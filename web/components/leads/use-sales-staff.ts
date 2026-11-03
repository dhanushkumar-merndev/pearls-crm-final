"use client";

import { useQuery } from "@tanstack/react-query";
import { rpc } from "@/lib/rpc";
import type { SalesStaff } from "./types";

/**
 * Active sales executives and managers, for owner dropdowns and filters.
 * Read through `staff_directory` (names for every signed-in role): the `staff` table itself only shows
 * a non-admin their own row, so a sales manager reading it directly saw nobody but themselves.
 */
export function useSalesStaff() {
  return useQuery({
    queryKey: ["sales_staff"],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await rpc<(SalesStaff | { id: string; full_name: string; role: string })[]>("staff_directory")).filter(
        (s): s is SalesStaff => s.role === "sales_executive" || s.role === "sales_manager",
      ),
  });
}
