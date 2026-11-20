import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getMe } from "@/lib/session";
import type { StaffRole } from "@pearl/shared";

const SALES_PAPERS: readonly StaffRole[] = ["sales_executive", "sales_manager", "admin"];

/** Quotations: the lead's owner, sales managers and admins (the database checks the lead too). */
export default async function SalesPrintLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  if (!me || !SALES_PAPERS.includes(me.role)) notFound();
  return children;
}
