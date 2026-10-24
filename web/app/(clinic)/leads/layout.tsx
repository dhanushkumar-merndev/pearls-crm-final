import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/session";

/** Lead pages are for sales managers and admins (executives use the phone app). The database checks again. */
export default async function LeadsLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (me?.role !== "sales_manager" && me?.role !== "admin") notFound();
  return children;
}
