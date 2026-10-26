import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SalesTargets } from "@/components/sales/sales-targets";
import { getMe } from "@/lib/session";

export const metadata: Metadata = { title: "Sales targets" };

/** Admin sets monthly targets; the sales manager watches progress. The database checks again. */
export default async function TargetsPage() {
  const me = await getMe();
  if (me?.role !== "admin" && me?.role !== "sales_manager") notFound();
  return <SalesTargets canEdit={me.role === "admin"} />;
}
