import type { ReactNode } from "react";
import { onlyFor } from "@/lib/session";

/** Lead pages: sales executives (their own leads: the sheet and a lead's page), sales managers and admins. The database checks again. */
export default async function LeadsLayout({ children }: { children: ReactNode }) {
  await onlyFor(["sales_executive", "sales_manager", "admin"]);
  return children;
}
