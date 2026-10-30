import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getMe } from "@/lib/session";

/** The Ads page is for sales managers and admins. The database checks again. */
export default async function AdsLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (me?.role !== "sales_manager" && me?.role !== "admin") notFound();
  return children;
}
