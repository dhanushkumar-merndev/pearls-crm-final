import type { ReactNode } from "react";
import { onlyFor } from "@/lib/session";

/** Sales see their leads' bookings here; reception and admin use Appointments (admin may still open it). */
export default async function BookingsLayout({ children }: { children: ReactNode }) {
  await onlyFor(["sales_executive", "sales_manager", "admin"]);
  return children;
}
